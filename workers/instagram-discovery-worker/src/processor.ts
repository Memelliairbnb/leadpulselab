import { Job, Queue } from "bullmq";
import { db, rawInstagramProfiles, instagramDiscoveryRuns } from "@alh/db";
import { redisConnection } from "@alh/queues";
import { eq, and } from "drizzle-orm";
import { logger } from "@alh/observability";
import type { InstagramDiscoveryJobData } from "@alh/queues";
import { parse as parseHTML } from "node-html-parser";
import https from "node:https";
import http from "node:http";
import crypto from "node:crypto";

const log = logger.child({ module: "instagram-discovery-processor" });

// ─── Rate-limiting constants ────────────────────────────────────────────────

const DUCKDUCKGO_DELAY_MS = { min: 3000, max: 5000 };
const INSTAGRAM_DELAY_MS = { min: 2000, max: 3000 };
const MAX_PROFILES_PER_SEARCH = 20;

// ─── User-Agent rotation ────────────────────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── Utility helpers ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function politeDelay(range: { min: number; max: number }): Promise<void> {
  const delay = range.min + Math.random() * (range.max - range.min);
  await sleep(delay);
}

function textHash(text: string): string {
  return crypto.createHash("sha256").update(text.toLowerCase().trim()).digest("hex").slice(0, 64);
}

// ─── HTTP helper (follows redirects, rotates UA) ────────────────────────────

function httpGet(
  url: string,
  opts: { timeoutMs?: number; maxRedirects?: number } = {}
): Promise<{ status: number; body: string; redirectedTo?: string }> {
  const { timeoutMs = 10_000, maxRedirects = 3 } = opts;

  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const ua = randomUserAgent();

    const req = mod.get(
      url,
      {
        headers: {
          "User-Agent": ua,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: timeoutMs,
      },
      (res) => {
        // Follow redirects
        if (
          (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307) &&
          res.headers.location &&
          maxRedirects > 0
        ) {
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).toString();

          // Drain current response
          res.resume();

          httpGet(redirectUrl, { timeoutMs, maxRedirects: maxRedirects - 1 })
            .then((r) => resolve({ ...r, redirectedTo: redirectUrl }))
            .catch(reject);
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    });
  });
}

// ─── Regex patterns ─────────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const URL_RE = /https?:\/\/[^\s"'<>)}\]]+/g;
const LOCATION_RE =
  /(?:based in|located in|serving|📍|from)\s+([A-Z][A-Za-z\s]+(?:,\s*[A-Z]{2})?)/gi;
const CATEGORY_KEYWORDS = [
  "photographer",
  "salon",
  "realtor",
  "real estate",
  "credit repair",
  "credit restoration",
  "credit specialist",
  "credit expert",
  "financial advisor",
  "mortgage",
  "loan officer",
  "funding",
  "business coach",
  "consultant",
  "agency",
  "marketing",
  "designer",
  "fitness",
  "trainer",
  "coach",
  "broker",
  "attorney",
  "lawyer",
  "dentist",
  "doctor",
  "chiropractor",
  "plumber",
  "electrician",
  "contractor",
  "roofer",
  "landscaper",
  "restaurant",
  "catering",
  "beauty",
  "barber",
  "nail tech",
  "esthetician",
  "lashes",
  "tax preparer",
  "accountant",
  "bookkeeper",
  "insurance agent",
  "auto repair",
  "mechanic",
  "cleaning service",
];

// ─── DuckDuckGo HTML search ─────────────────────────────────────────────────

interface DuckDuckGoResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchDuckDuckGo(query: string): Promise<DuckDuckGoResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

  log.info({ query, searchUrl }, "Searching DuckDuckGo");

  let res: { status: number; body: string };
  try {
    res = await httpGet(searchUrl);
  } catch (err) {
    log.warn({ error: (err as Error).message, query }, "DuckDuckGo request failed");
    return [];
  }

  if (res.status === 429 || res.status === 403) {
    log.warn({ status: res.status }, "DuckDuckGo rate limited or captcha, skipping");
    return [];
  }

  if (res.status !== 200) {
    log.warn({ status: res.status }, "DuckDuckGo non-200 response");
    return [];
  }

  // Check for captcha in body
  if (res.body.includes("duckduckgo.com/d.js") && res.body.includes("Please try again")) {
    log.warn("DuckDuckGo captcha detected, skipping");
    return [];
  }

  const results: DuckDuckGoResult[] = [];

  try {
    const root = parseHTML(res.body);
    const resultLinks = root.querySelectorAll(".result__a");
    const resultSnippets = root.querySelectorAll(".result__snippet");

    for (let i = 0; i < resultLinks.length && i < MAX_PROFILES_PER_SEARCH; i++) {
      const linkEl = resultLinks[i];
      const snippetEl = resultSnippets[i];

      // DuckDuckGo wraps URLs in a redirect — extract the actual URL
      let href = linkEl.getAttribute("href") ?? "";

      // DuckDuckGo HTML format: //duckduckgo.com/l/?uddg=ENCODED_URL&...
      if (href.includes("uddg=")) {
        const uddgMatch = href.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          href = decodeURIComponent(uddgMatch[1]);
        }
      }

      const title = linkEl.textContent?.trim() ?? "";
      const snippet = snippetEl?.textContent?.trim() ?? "";

      if (href && title) {
        results.push({ title, url: href, snippet });
      }
    }
  } catch (err) {
    log.warn({ error: (err as Error).message }, "Failed to parse DuckDuckGo HTML results");
  }

  log.info({ query, resultCount: results.length }, "DuckDuckGo search complete");
  return results;
}

// ─── Extract Instagram handles from search results ──────────────────────────

interface DiscoveredProfile {
  handle: string;
  profileUrl: string;
  searchSnippet: string;
  searchTitle: string;
}

function extractInstagramProfiles(results: DuckDuckGoResult[]): DiscoveredProfile[] {
  const profiles: DiscoveredProfile[] = [];
  const seenHandles = new Set<string>();

  for (const result of results) {
    // Match instagram.com/username patterns
    const igMatch = result.url.match(
      /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+)\/?(?:\?.*)?$/
    );

    if (!igMatch) continue;

    const handle = igMatch[1].toLowerCase();

    // Skip non-profile pages
    const skipHandles = [
      "p",
      "reel",
      "reels",
      "stories",
      "explore",
      "accounts",
      "about",
      "legal",
      "developer",
      "directory",
      "tags",
      "locations",
    ];
    if (skipHandles.includes(handle)) continue;

    // Skip if already seen
    if (seenHandles.has(handle)) continue;
    seenHandles.add(handle);

    profiles.push({
      handle,
      profileUrl: `https://www.instagram.com/${handle}/`,
      searchSnippet: result.snippet,
      searchTitle: result.title,
    });
  }

  return profiles;
}

// ─── Instagram profile meta scraping ────────────────────────────────────────

interface InstagramProfileMeta {
  displayName: string | null;
  handle: string | null;
  bioText: string | null;
  followerCount: number | null;
  followingCount: number | null;
  postCount: number | null;
  isPrivate: boolean;
  category: string | null;
  websiteUrl: string | null;
  emails: string[];
  phones: string[];
  locationClues: string[];
}

async function scrapeInstagramProfile(profileUrl: string): Promise<InstagramProfileMeta | null> {
  let res: { status: number; body: string; redirectedTo?: string };
  try {
    res = await httpGet(profileUrl);
  } catch (err) {
    log.warn({ error: (err as Error).message, profileUrl }, "Instagram fetch failed");
    return null;
  }

  // Check for rate limiting or login redirect
  if (res.status === 429) {
    log.warn({ profileUrl }, "Instagram rate limited (429)");
    return null;
  }

  if (res.status !== 200) {
    log.warn({ status: res.status, profileUrl }, "Instagram non-200 response");
    return null;
  }

  // Check if redirected to login page
  if (
    res.redirectedTo?.includes("/accounts/login") ||
    res.body.includes('"require_login":true') ||
    (res.body.includes("/accounts/login") && res.body.length < 5000)
  ) {
    log.warn({ profileUrl }, "Instagram redirected to login, profile may be private or rate limited");
    return null;
  }

  const meta: InstagramProfileMeta = {
    displayName: null,
    handle: null,
    bioText: null,
    followerCount: null,
    followingCount: null,
    postCount: null,
    isPrivate: false,
    category: null,
    websiteUrl: null,
    emails: [],
    phones: [],
    locationClues: [],
  };

  try {
    const root = parseHTML(res.body);

    // ─── Extract from meta tags ───────────────────────────────────────
    const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "";
    const ogDesc = root.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? "";
    const metaDesc = root.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";

    // og:title format: "Display Name (@handle) ..."
    const titleMatch = ogTitle.match(/^(.+?)\s*\(@([a-zA-Z0-9_.]+)\)/);
    if (titleMatch) {
      meta.displayName = titleMatch[1].trim();
      meta.handle = titleMatch[2].toLowerCase();
    }

    // og:description or meta description typically contains the bio
    // Format: "X Followers, Y Following, Z Posts - See Instagram photos and videos from Display Name (@handle)"
    // OR the bio text directly
    const descText = ogDesc || metaDesc;
    meta.bioText = descText || null;

    // Extract follower/following/post counts from description
    // Common format: "123 Followers, 45 Following, 67 Posts"
    // Also handles: "1,234 Followers" and "1.2k Followers" and "12.3M Followers"
    const allText = `${ogTitle} ${ogDesc} ${metaDesc}`;

    const followerMatch = allText.match(/([\d,.]+[kKmM]?)\s*Followers/i);
    if (followerMatch) meta.followerCount = parseCount(followerMatch[1]);

    const followingMatch = allText.match(/([\d,.]+[kKmM]?)\s*Following/i);
    if (followingMatch) meta.followingCount = parseCount(followingMatch[1]);

    const postMatch = allText.match(/([\d,.]+[kKmM]?)\s*Posts/i);
    if (postMatch) meta.postCount = parseCount(postMatch[1]);

    // Check for private account indicator
    if (allText.includes("Private") || res.body.includes('"is_private":true')) {
      meta.isPrivate = true;
    }

    // ─── Parse bio for contact info ─────────────────────────────────────

    const bioText = meta.bioText ?? "";

    // Extract emails
    const emails = bioText.match(EMAIL_RE);
    if (emails) meta.emails = [...new Set(emails)];

    // Extract phones
    const phones = bioText.match(PHONE_RE);
    if (phones) meta.phones = [...new Set(phones)];

    // Extract website URLs from bio
    const urls = bioText.match(URL_RE);
    if (urls && urls.length > 0) {
      // Pick the first non-instagram URL
      const externalUrl = urls.find((u) => !u.includes("instagram.com"));
      if (externalUrl) meta.websiteUrl = externalUrl;
    }

    // Also check for linktree / linktr.ee / bio links in the page body
    const linkPatterns = [
      /linktr\.ee\/[a-zA-Z0-9_.]+/g,
      /linkin\.bio\/[a-zA-Z0-9_.]+/g,
      /lnk\.bio\/[a-zA-Z0-9_.]+/g,
      /beacons\.ai\/[a-zA-Z0-9_.]+/g,
      /stan\.store\/[a-zA-Z0-9_.]+/g,
    ];
    for (const pattern of linkPatterns) {
      const linkMatch = res.body.match(pattern);
      if (linkMatch && !meta.websiteUrl) {
        meta.websiteUrl = `https://${linkMatch[0]}`;
      }
    }

    // ─── Extract location clues ───────────────────────────────────────

    let locMatch: RegExpExecArray | null;
    LOCATION_RE.lastIndex = 0;
    while ((locMatch = LOCATION_RE.exec(bioText)) !== null) {
      meta.locationClues.push(locMatch[1].trim());
    }

    // ─── Detect category from bio ─────────────────────────────────────

    const bioLower = bioText.toLowerCase();
    for (const cat of CATEGORY_KEYWORDS) {
      if (bioLower.includes(cat)) {
        meta.category = cat;
        break;
      }
    }

    // Also check for Instagram's own category label in page source
    const categoryMatch = res.body.match(/"category_name":"([^"]+)"/);
    if (categoryMatch) {
      meta.category = categoryMatch[1];
    }
  } catch (err) {
    log.warn({ error: (err as Error).message, profileUrl }, "Failed to parse Instagram profile HTML");
  }

  return meta;
}

/** Parse count strings like "1,234", "12.3k", "1.2M" into integers. */
function parseCount(raw: string): number | null {
  if (!raw) return null;

  const cleaned = raw.replace(/,/g, "").trim();
  const multiplierMatch = cleaned.match(/^([\d.]+)\s*([kKmM])?$/);
  if (!multiplierMatch) return null;

  let num = parseFloat(multiplierMatch[1]);
  const suffix = (multiplierMatch[2] ?? "").toLowerCase();

  if (suffix === "k") num *= 1_000;
  if (suffix === "m") num *= 1_000_000;

  return Math.round(num);
}

// ─── Scrub queue helper ─────────────────────────────────────────────────────

let scrubQueue: Queue | null = null;

function getScrubQueue(): Queue {
  if (!scrubQueue) {
    scrubQueue = new Queue("instagram_scrub_queue", {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: false,
      },
    });
  }
  return scrubQueue;
}

async function enqueueScrub(tenantId: number, rawProfileId: number, discoveryRunId: number): Promise<void> {
  const queue = getScrubQueue();
  await queue.add(
    "scrub",
    { tenantId, rawProfileId, discoveryRunId },
    { jobId: `ig-scrub-${rawProfileId}-${Date.now()}` }
  );
}

// ─── Main processor ─────────────────────────────────────────────────────────

export async function processInstagramDiscovery(job: Job<InstagramDiscoveryJobData>) {
  const { tenantId, searchQuery, searchType, discoveryRunId } = job.data;

  log.info({ tenantId, searchQuery, searchType, discoveryRunId }, "Starting Instagram discovery");

  // Mark the discovery run as running
  try {
    await db
      .update(instagramDiscoveryRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(instagramDiscoveryRuns.id, discoveryRunId));
  } catch (err) {
    log.warn({ error: (err as Error).message }, "Failed to update discovery run status");
  }

  let profilesFoundCount = 0;

  try {
    // ─── Step 1: Search DuckDuckGo ────────────────────────────────────
    const searchResults = await searchDuckDuckGo(searchQuery);

    if (searchResults.length === 0) {
      log.info({ searchQuery }, "No DuckDuckGo results found");
      await markDiscoveryComplete(discoveryRunId, 0);
      return { discoveryRunId, profilesFound: 0 };
    }

    // ─── Step 2: Extract Instagram profile URLs ───────────────────────
    const discoveredProfiles = extractInstagramProfiles(searchResults);
    log.info(
      { searchQuery, profileCount: discoveredProfiles.length },
      "Extracted Instagram profiles from search results"
    );

    if (discoveredProfiles.length === 0) {
      log.info({ searchQuery }, "No Instagram profiles found in search results");
      await markDiscoveryComplete(discoveryRunId, 0);
      return { discoveryRunId, profilesFound: 0 };
    }

    // ─── Step 3: Scrape each profile and insert ─────────────────────
    for (const profile of discoveredProfiles) {
      try {
        // Be polite to Instagram
        await politeDelay(INSTAGRAM_DELAY_MS);

        // Update job progress
        await job.updateProgress(
          Math.round((profilesFoundCount / discoveredProfiles.length) * 100)
        );

        log.info({ handle: profile.handle }, "Scraping Instagram profile");
        const meta = await scrapeInstagramProfile(profile.profileUrl);

        // Build the row — even if meta scraping failed, we still have the handle
        const handle = meta?.handle ?? profile.handle;
        const hash = textHash(handle);

        const insertValues = {
          tenantId,
          discoveryRunId,
          instagramHandle: handle,
          profileUrl: profile.profileUrl,
          displayName: meta?.displayName ?? null,
          bioText: meta?.bioText ?? null,
          category: meta?.category ?? null,
          websiteUrl: meta?.websiteUrl ?? null,
          publicEmailCandidate: meta?.emails?.[0] ?? null,
          publicPhoneCandidate: meta?.phones?.[0] ?? null,
          locationClues: meta?.locationClues?.join("; ") || null,
          followerCount: meta?.followerCount ?? null,
          followingCount: meta?.followingCount ?? null,
          postCount: meta?.postCount ?? null,
          isBusiness: meta?.category != null,
          isPrivate: meta?.isPrivate ?? false,
          discoveryReason: `${searchType}: ${searchQuery}`,
          rawMetadataJson: {
            searchTitle: profile.searchTitle,
            searchSnippet: profile.searchSnippet,
            allEmails: meta?.emails ?? [],
            allPhones: meta?.phones ?? [],
            allLocationClues: meta?.locationClues ?? [],
          },
          processingStatus: "pending" as const,
          textHash: hash,
        };

        // Insert with ON CONFLICT DO NOTHING (unique on tenant + handle)
        let insertedId: number | null = null;
        try {
          const rows = await db
            .insert(rawInstagramProfiles)
            .values(insertValues)
            .onConflictDoNothing({ target: [rawInstagramProfiles.tenantId, rawInstagramProfiles.instagramHandle] })
            .returning({ id: rawInstagramProfiles.id });

          if (rows.length > 0) {
            insertedId = rows[0].id;
            profilesFoundCount++;
            log.info({ handle, id: insertedId }, "Inserted raw Instagram profile");
          } else {
            log.info({ handle }, "Profile already exists, skipping");

            // Get the existing profile ID so we can still queue it
            const [existing] = await db
              .select({ id: rawInstagramProfiles.id })
              .from(rawInstagramProfiles)
              .where(
                and(
                  eq(rawInstagramProfiles.tenantId, tenantId),
                  eq(rawInstagramProfiles.instagramHandle, handle)
                )
              )
              .limit(1);

            insertedId = existing?.id ?? null;
          }
        } catch (dbErr) {
          log.warn(
            { error: (dbErr as Error).message, handle },
            "Failed to insert raw profile, continuing"
          );
          continue;
        }

        // ─── Step 4: Queue for Worker 2 (scrub) ───────────────────────
        if (insertedId) {
          try {
            await enqueueScrub(tenantId, insertedId, discoveryRunId);
            log.info({ rawProfileId: insertedId, handle }, "Queued profile for scrub");
          } catch (queueErr) {
            log.warn(
              { error: (queueErr as Error).message, handle },
              "Failed to queue profile for scrub"
            );
          }
        }
      } catch (profileErr) {
        // Never crash on individual profile failure
        log.warn(
          { error: (profileErr as Error).message, handle: profile.handle },
          "Failed to process profile, continuing"
        );
      }
    }

    // ─── Step 5: Update discovery run ─────────────────────────────────
    await markDiscoveryComplete(discoveryRunId, profilesFoundCount);

    log.info(
      { discoveryRunId, searchQuery, profilesFound: profilesFoundCount },
      "Instagram discovery job complete"
    );

    return { discoveryRunId, profilesFound: profilesFoundCount };
  } catch (err) {
    // Mark the run as failed
    try {
      await db
        .update(instagramDiscoveryRuns)
        .set({
          status: "failed",
          completedAt: new Date(),
          errorMessage: (err as Error).message,
          profilesFound: profilesFoundCount,
        })
        .where(eq(instagramDiscoveryRuns.id, discoveryRunId));
    } catch {
      // Swallow
    }

    throw err;
  }
}

async function markDiscoveryComplete(discoveryRunId: number, profilesFound: number): Promise<void> {
  try {
    await db
      .update(instagramDiscoveryRuns)
      .set({
        status: "completed",
        completedAt: new Date(),
        profilesFound,
      })
      .where(eq(instagramDiscoveryRuns.id, discoveryRunId));
  } catch (err) {
    log.warn({ error: (err as Error).message }, "Failed to mark discovery run as complete");
  }
}
