import { Job } from "bullmq";
import { db, rawInstagramProfiles, instagramDiscoveryRuns } from "@alh/db";
import { eq, and } from "drizzle-orm";
import { getQueue, QUEUE_NAMES } from "@alh/queues";
import type { InstagramDiscoveryJobData } from "@alh/queues";
import { logger } from "@alh/observability";
import { parse as parseHTML } from "node-html-parser";
import https from "node:https";
import http from "node:http";
import crypto from "node:crypto";

const log = logger.child({ module: "instagram-discovery-processor" });

// ─── Constants ─────────────────────────────────────────────────────────────

const DDGS_DELAY = { min: 3000, max: 5000 };
const IG_DELAY = { min: 2000, max: 3000 };
const MAX_PROFILES_PER_SEARCH = 20;
const HTTP_TIMEOUT_MS = 15_000;

// ─── User-Agent rotation (10 desktop browser strings) ──────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── Utility helpers ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function politeDelay(range: { min: number; max: number }): Promise<void> {
  const ms = range.min + Math.floor(Math.random() * (range.max - range.min));
  await sleep(ms);
}

function makeTextHash(text: string): string {
  return crypto.createHash("sha256").update(text.toLowerCase().trim()).digest("hex").slice(0, 64);
}

// ─── HTTP helper (follows redirects, rotates UA) ───────────────────────────

interface HttpResponse {
  status: number;
  body: string;
  redirectedTo?: string;
}

function httpGet(
  url: string,
  opts: { timeoutMs?: number; maxRedirects?: number } = {},
): Promise<HttpResponse> {
  const { timeoutMs = HTTP_TIMEOUT_MS, maxRedirects = 3 } = opts;

  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;

    const req = mod.get(
      url,
      {
        headers: {
          "User-Agent": randomUA(),
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const code = res.statusCode ?? 0;

        // Follow redirects (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && maxRedirects > 0) {
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).toString();
          res.resume(); // drain
          httpGet(redirectUrl, { timeoutMs, maxRedirects: maxRedirects - 1 })
            .then((r) => resolve({ ...r, redirectedTo: redirectUrl }))
            .catch(reject);
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ status: code, body: Buffer.concat(chunks).toString("utf-8") });
        });
        res.on("error", reject);
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`HTTP timeout after ${timeoutMs}ms: ${url}`));
    });
  });
}

// ─── Regex patterns ────────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const URL_RE = /https?:\/\/[^\s"'<>)}\]]+/g;
const LOCATION_RE =
  /(?:based in|located in|serving|📍|from)\s+([A-Z][A-Za-z\s]+(?:,\s*[A-Z]{2})?)/gi;

const BUSINESS_CATEGORY_MAP: Record<string, string[]> = {
  credit_repair: [
    "credit repair", "credit restoration", "credit fix", "credit score",
    "credit building", "credit improvement", "fico", "credit consultant",
    "credit specialist", "credit expert",
  ],
  mortgage: [
    "mortgage", "home loan", "loan officer", "lending", "refinance",
    "home buyer", "real estate loan", "nmls",
  ],
  insurance: [
    "insurance", "life insurance", "health insurance", "auto insurance",
    "coverage", "policy", "insurance agent",
  ],
  real_estate: [
    "realtor", "real estate", "realty", "broker", "property",
    "homes for sale", "listing agent", "buyer agent",
  ],
  tax_services: [
    "tax preparer", "cpa", "accounting", "bookkeeping",
    "tax preparation", "enrolled agent", "tax resolution", "accountant",
  ],
  financial_planning: [
    "financial advisor", "financial planner", "wealth management",
    "investment", "retirement planning", "cfp", "financial coaching",
  ],
  debt_relief: [
    "debt relief", "debt consolidation", "debt settlement",
    "debt free", "debt management",
  ],
  legal: ["attorney", "lawyer", "law firm", "legal", "paralegal"],
  auto: ["auto dealer", "car dealer", "used cars", "auto sales", "dealership", "auto repair", "mechanic"],
  health_wellness: ["dentist", "doctor", "chiropractor", "fitness", "trainer", "coach"],
  home_services: ["plumber", "electrician", "contractor", "roofer", "landscaper", "cleaning service"],
  beauty: ["salon", "beauty", "barber", "nail tech", "esthetician", "lashes"],
  food_service: ["restaurant", "catering", "chef", "bakery"],
  marketing: ["marketing", "agency", "designer", "branding", "social media manager"],
  business_coaching: ["business coach", "consultant", "funding"],
  photography: ["photographer", "photography", "videographer"],
};

// Handles that are IG pages, not user profiles
const SKIP_HANDLES = new Set([
  "p", "reel", "reels", "stories", "explore", "accounts", "about",
  "legal", "developer", "directory", "tags", "locations", "tv",
  "web", "static", "direct", "lite", "help", "privacy", "terms",
]);

// ─── DuckDuckGo HTML search ───────────────────────────────────────────────

interface DDGResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchDuckDuckGo(query: string): Promise<DDGResult[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  log.info({ query }, "Searching DuckDuckGo");

  let res: HttpResponse;
  try {
    res = await httpGet(searchUrl);
  } catch (err) {
    log.warn({ error: (err as Error).message, query }, "DuckDuckGo request failed");
    return [];
  }

  if (res.status === 429 || res.status === 403) {
    log.warn({ status: res.status }, "DuckDuckGo rate limited or blocked");
    return [];
  }
  if (res.status !== 200) {
    log.warn({ status: res.status }, "DuckDuckGo non-200 response");
    return [];
  }

  // Check for captcha page
  if (
    (res.body.includes("duckduckgo.com/d.js") && res.body.includes("Please try again")) ||
    res.body.includes("bot traffic") ||
    res.body.includes("unusual traffic")
  ) {
    log.warn("DuckDuckGo captcha/bot-detection triggered, skipping");
    return [];
  }

  const results: DDGResult[] = [];
  try {
    const root = parseHTML(res.body);
    const resultLinks = root.querySelectorAll(".result__a");
    const resultSnippets = root.querySelectorAll(".result__snippet");

    for (let i = 0; i < resultLinks.length; i++) {
      const linkEl = resultLinks[i];
      const snippetEl = resultSnippets[i];

      let href = linkEl.getAttribute("href") ?? "";

      // DuckDuckGo wraps URLs: //duckduckgo.com/l/?uddg=ENCODED_URL&...
      if (href.includes("uddg=")) {
        const uddgMatch = href.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          try {
            href = decodeURIComponent(uddgMatch[1]);
          } catch {
            // bad encoding, use raw
          }
        }
      }

      const title = linkEl.textContent?.trim() ?? "";
      const snippet = snippetEl?.textContent?.trim() ?? "";

      if (href && title) {
        results.push({ title, url: href, snippet });
      }
    }
  } catch (err) {
    log.warn({ error: (err as Error).message }, "Failed to parse DuckDuckGo HTML");
  }

  log.info({ query, resultCount: results.length }, "DuckDuckGo search complete");
  return results;
}

// ─── Extract Instagram handles from search results ─────────────────────────

interface DiscoveredHandle {
  handle: string;
  profileUrl: string;
  searchTitle: string;
  searchSnippet: string;
}

function extractInstagramHandles(results: DDGResult[]): DiscoveredHandle[] {
  const handles: DiscoveredHandle[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const igMatch = result.url.match(
      /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{1,30})\/?(?:\?.*)?$/,
    );
    if (!igMatch) continue;

    const handle = igMatch[1].toLowerCase();
    if (SKIP_HANDLES.has(handle)) continue;
    if (handle.startsWith(".") || handle.endsWith(".")) continue;
    if (seen.has(handle)) continue;
    seen.add(handle);

    handles.push({
      handle,
      profileUrl: `https://www.instagram.com/${handle}/`,
      searchTitle: result.title,
      searchSnippet: result.snippet,
    });

    if (handles.length >= MAX_PROFILES_PER_SEARCH) break;
  }

  // Also scan snippets/titles for additional handles mentioned inline
  const inlineRe = /instagram\.com\/([a-zA-Z0-9_.]{2,30})\b/gi;
  for (const result of results) {
    const text = `${result.title} ${result.snippet} ${result.url}`;
    let m: RegExpExecArray | null;
    while ((m = inlineRe.exec(text)) !== null) {
      const handle = m[1].toLowerCase();
      if (SKIP_HANDLES.has(handle) || seen.has(handle)) continue;
      if (handle.startsWith(".") || handle.endsWith(".")) continue;
      seen.add(handle);
      handles.push({
        handle,
        profileUrl: `https://www.instagram.com/${handle}/`,
        searchTitle: result.title,
        searchSnippet: result.snippet,
      });
      if (handles.length >= MAX_PROFILES_PER_SEARCH) break;
    }
    if (handles.length >= MAX_PROFILES_PER_SEARCH) break;
  }

  return handles;
}

// ─── Instagram profile meta-tag scraping ───────────────────────────────────

interface ProfileMeta {
  displayName: string | null;
  resolvedHandle: string | null;
  bioText: string | null;
  followerCount: number | null;
  followingCount: number | null;
  postCount: number | null;
  isPrivate: boolean;
  isBusiness: boolean;
  category: string | null;
  websiteUrl: string | null;
  emails: string[];
  phones: string[];
  locationClues: string[];
  rawOg: Record<string, string>;
}

async function scrapeInstagramProfile(profileUrl: string): Promise<ProfileMeta | null> {
  let res: HttpResponse;
  try {
    res = await httpGet(profileUrl);
  } catch (err) {
    log.warn({ error: (err as Error).message, profileUrl }, "Instagram fetch failed");
    return null;
  }

  // Rate limiting
  if (res.status === 429) {
    log.warn({ profileUrl }, "Instagram rate limited (429)");
    return null;
  }

  // 404 = profile doesn't exist
  if (res.status === 404) {
    log.debug({ profileUrl }, "Instagram profile not found (404)");
    return null;
  }

  if (res.status !== 200) {
    log.warn({ status: res.status, profileUrl }, "Instagram non-200 response");
    return null;
  }

  // Detect login-wall redirect
  if (
    res.redirectedTo?.includes("/accounts/login") ||
    res.body.includes('"require_login":true') ||
    (res.body.includes("/accounts/login") && res.body.length < 5000)
  ) {
    log.debug({ profileUrl }, "Instagram login redirect — may be private or rate-gated");
    // Return minimal data so we still record the handle exists
    return {
      displayName: null,
      resolvedHandle: null,
      bioText: null,
      followerCount: null,
      followingCount: null,
      postCount: null,
      isPrivate: true,
      isBusiness: false,
      category: null,
      websiteUrl: null,
      emails: [],
      phones: [],
      locationClues: [],
      rawOg: {},
    };
  }

  const meta: ProfileMeta = {
    displayName: null,
    resolvedHandle: null,
    bioText: null,
    followerCount: null,
    followingCount: null,
    postCount: null,
    isPrivate: false,
    isBusiness: false,
    category: null,
    websiteUrl: null,
    emails: [],
    phones: [],
    locationClues: [],
    rawOg: {},
  };

  try {
    const root = parseHTML(res.body);

    // ── Gather all meta tags ──────────────────────────────────────────
    const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "";
    const ogDesc = root.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? "";
    const metaDesc = root.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";

    meta.rawOg = { "og:title": ogTitle, "og:description": ogDesc, description: metaDesc };

    // ── Parse display name & handle from og:title ─────────────────────
    // Format: "Display Name (@handle) ..." or "Display Name on Instagram ..."
    const titleMatch = ogTitle.match(/^(.+?)\s*\(@([a-zA-Z0-9_.]+)\)/);
    if (titleMatch) {
      meta.displayName = titleMatch[1].trim();
      meta.resolvedHandle = titleMatch[2].toLowerCase();
    } else {
      // Fallback: "Name on Instagram: ..."
      const altMatch = ogTitle.match(/^(.+?)\s+on\s+Instagram/i);
      if (altMatch) meta.displayName = altMatch[1].trim();
    }

    // ── Parse counts from og:description ──────────────────────────────
    // Format: "123 Followers, 45 Following, 67 Posts - See photos and videos..."
    const allText = `${ogTitle} ${ogDesc} ${metaDesc}`;

    const followerMatch = allText.match(/([\d,.]+[kKmM]?)\s*Followers/i);
    if (followerMatch) meta.followerCount = parseCount(followerMatch[1]);

    const followingMatch = allText.match(/([\d,.]+[kKmM]?)\s*Following/i);
    if (followingMatch) meta.followingCount = parseCount(followingMatch[1]);

    const postMatch = allText.match(/([\d,.]+[kKmM]?)\s*Posts?/i);
    if (postMatch) meta.postCount = parseCount(postMatch[1]);

    // ── Bio text ──────────────────────────────────────────────────────
    // The og:description usually has "N Followers, N Following, N Posts - See ... from Name (@handle)"
    // The actual bio is sometimes in the meta description or after a dash
    const descText = ogDesc || metaDesc;
    if (descText) {
      // Try to extract just the bio part after the stats prefix
      const bioAfterStats = descText.match(
        /Posts?\s*[-–—]\s*(?:See Instagram photos and videos from\s+.+?(?:\)\s*[-–—:]\s*|$))(.+)/s,
      );
      if (bioAfterStats?.[1]) {
        meta.bioText = bioAfterStats[1].trim();
      } else {
        // Use the whole description as bio (it might just be the bio)
        meta.bioText = descText;
      }
    }

    // ── Privacy check ─────────────────────────────────────────────────
    if (allText.includes("Private") || res.body.includes('"is_private":true')) {
      meta.isPrivate = true;
    }

    // ── Contact info extraction ───────────────────────────────────────
    const searchable = `${meta.bioText ?? ""} ${allText}`;

    const emails = searchable.match(EMAIL_RE);
    if (emails) {
      meta.emails = [...new Set(emails)].filter(
        (e) => !e.endsWith(".png") && !e.endsWith(".jpg") && !e.endsWith(".gif"),
      );
    }

    const phones = searchable.match(PHONE_RE);
    if (phones) {
      meta.phones = [...new Set(phones)].filter(
        (p) => p.replace(/\D/g, "").length >= 10,
      );
    }

    // ── Website extraction ────────────────────────────────────────────
    const urls = searchable.match(URL_RE);
    if (urls) {
      const external = urls.find(
        (u) =>
          !u.includes("instagram.com") &&
          !u.includes("facebook.com") &&
          !u.includes("twitter.com") &&
          !u.includes("tiktok.com"),
      );
      if (external) meta.websiteUrl = external;
    }

    // Check for link-in-bio services in the full page body
    const linkPatterns = [
      /linktr\.ee\/[a-zA-Z0-9_.]+/,
      /linkin\.bio\/[a-zA-Z0-9_.]+/,
      /lnk\.bio\/[a-zA-Z0-9_.]+/,
      /beacons\.ai\/[a-zA-Z0-9_.]+/,
      /stan\.store\/[a-zA-Z0-9_.]+/,
      /tap\.bio\/[a-zA-Z0-9_.]+/,
    ];
    if (!meta.websiteUrl) {
      for (const pat of linkPatterns) {
        const m = res.body.match(pat);
        if (m) {
          meta.websiteUrl = `https://${m[0]}`;
          break;
        }
      }
    }

    // ── Location clues ────────────────────────────────────────────────
    LOCATION_RE.lastIndex = 0;
    let locMatch: RegExpExecArray | null;
    while ((locMatch = LOCATION_RE.exec(searchable)) !== null) {
      const loc = locMatch[1].trim();
      if (loc.length > 2 && loc.length < 200) {
        meta.locationClues.push(loc);
      }
    }
    // Also look for "City, ST" pattern
    const cityStateRe = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2})\b/g;
    let csMatch: RegExpExecArray | null;
    while ((csMatch = cityStateRe.exec(searchable)) !== null) {
      if (!meta.locationClues.includes(csMatch[1])) {
        meta.locationClues.push(csMatch[1]);
      }
    }

    // ── Business category detection ───────────────────────────────────
    const bioLower = (meta.bioText ?? searchable).toLowerCase();

    // First check Instagram's own category_name in page source
    const igCat = res.body.match(/"category_name":"([^"]+)"/);
    if (igCat) {
      meta.category = igCat[1];
      meta.isBusiness = true;
    } else {
      // Fall back to keyword matching
      for (const [category, keywords] of Object.entries(BUSINESS_CATEGORY_MAP)) {
        for (const kw of keywords) {
          if (bioLower.includes(kw)) {
            meta.category = category;
            meta.isBusiness = true;
            break;
          }
        }
        if (meta.category) break;
      }
    }

    // Additional business signals even without a matched category
    if (!meta.isBusiness) {
      const bizSignals = ["book now", "dm for", "link in bio", "contact us", "free consultation", "schedule"];
      meta.isBusiness = bizSignals.some((s) => bioLower.includes(s));
    }
  } catch (err) {
    log.warn({ error: (err as Error).message, profileUrl }, "Failed to parse Instagram profile HTML");
  }

  return meta;
}

// ─── Count parser: "1,234", "12.3k", "1.2M" → integer ─────────────────────

function parseCount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, "").trim();
  const m = cleaned.match(/^([\d.]+)\s*([kKmM])?$/);
  if (!m) return null;

  let num = parseFloat(m[1]);
  const suffix = (m[2] ?? "").toLowerCase();
  if (suffix === "k") num *= 1_000;
  if (suffix === "m") num *= 1_000_000;

  return Math.round(num);
}

// ─── Search query builder ──────────────────────────────────────────────────

function buildSearchQueries(searchQuery: string, searchType: string): string[] {
  // Avoid "site:instagram.com" — DuckDuckGo blocks/throttles those queries.
  // Instead use "instagram" + keywords which surfaces instagram.com URLs naturally.
  switch (searchType) {
    case "niche_keyword":
      return [
        `"${searchQuery}" instagram profile`,
        `"${searchQuery}" instagram business`,
        `"${searchQuery}" @instagram contact email`,
        `"${searchQuery}" instagram specialist near me`,
      ];

    case "location":
      return [
        `"${searchQuery}" credit repair instagram`,
        `"${searchQuery}" credit restoration instagram`,
        `"${searchQuery}" financial services instagram business`,
      ];

    case "competitor_followers":
      return [
        `"${searchQuery}" instagram profile`,
        `similar to "${searchQuery}" instagram`,
      ];

    case "hashtag": {
      const tag = searchQuery.replace(/^#/, "");
      return [
        `#${tag} instagram business`,
        `${tag} instagram profile contact`,
      ];
    }

    default:
      return [
        `"${searchQuery}" instagram profile`,
        `"${searchQuery}" instagram business contact`,
      ];
  }
}

// ─── Main processor ────────────────────────────────────────────────────────

export async function processInstagramDiscovery(
  job: Job<InstagramDiscoveryJobData>,
): Promise<{ discoveryRunId: number; profilesFound: number; profilesInserted: number }> {
  const { tenantId, searchQuery, searchType, discoveryRunId } = job.data;

  log.info({ tenantId, searchQuery, searchType, discoveryRunId }, "Starting Instagram discovery");

  // Mark discovery run as running
  try {
    await db
      .update(instagramDiscoveryRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(instagramDiscoveryRuns.id, discoveryRunId));
  } catch (err) {
    log.warn({ error: (err as Error).message }, "Failed to update discovery run status to running");
  }

  let profilesInserted = 0;
  let totalHandlesFound = 0;

  try {
    // ── Phase 1: Search DuckDuckGo with multiple query variants ───────
    const queries = buildSearchQueries(searchQuery, searchType);
    const allHandles: DiscoveredHandle[] = [];
    const seenHandles = new Set<string>();

    for (let qi = 0; qi < queries.length; qi++) {
      if (allHandles.length >= MAX_PROFILES_PER_SEARCH) break;

      const q = queries[qi];
      await job.updateProgress(Math.round((qi / queries.length) * 25));

      try {
        const ddgResults = await searchDuckDuckGo(q);
        const extracted = extractInstagramHandles(ddgResults);

        for (const h of extracted) {
          if (seenHandles.has(h.handle)) continue;
          seenHandles.add(h.handle);
          allHandles.push(h);
          if (allHandles.length >= MAX_PROFILES_PER_SEARCH) break;
        }
      } catch (err) {
        log.error({ query: q, error: (err as Error).message }, "DuckDuckGo search error");
      }

      // Polite delay between DDGS requests (skip after last query)
      if (qi < queries.length - 1 && allHandles.length < MAX_PROFILES_PER_SEARCH) {
        await politeDelay(DDGS_DELAY);
      }
    }

    totalHandlesFound = allHandles.length;
    log.info({ discoveryRunId, handlesFound: totalHandlesFound }, "DuckDuckGo search phase complete");

    if (allHandles.length === 0) {
      log.info({ searchQuery }, "No Instagram profiles found in search results");
      await markDiscoveryDone(discoveryRunId, "completed", 0);
      return { discoveryRunId, profilesFound: 0, profilesInserted: 0 };
    }

    // ── Phase 2: Scrape each profile and insert into DB ──────────────
    const scrubQueue = getQueue(QUEUE_NAMES.INSTAGRAM_SCRUB);

    for (let i = 0; i < allHandles.length; i++) {
      const discovered = allHandles[i];

      // Progress: 25-95% for scraping phase
      await job.updateProgress(25 + Math.round(((i + 1) / allHandles.length) * 70));

      try {
        // Polite delay between Instagram requests (skip before first)
        if (i > 0) {
          await politeDelay(IG_DELAY);
        }

        log.debug({ handle: discovered.handle, progress: `${i + 1}/${allHandles.length}` }, "Scraping profile");
        const meta = await scrapeInstagramProfile(discovered.profileUrl);

        const handle = meta?.resolvedHandle ?? discovered.handle;
        const hashInput = `${handle}|${meta?.displayName ?? ""}|${meta?.bioText ?? ""}`;
        const hash = makeTextHash(hashInput);

        // Insert with ON CONFLICT DO NOTHING (unique on tenant + handle)
        const insertValues = {
          tenantId,
          discoveryRunId,
          instagramHandle: handle,
          profileUrl: discovered.profileUrl,
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
          isBusiness: meta?.isBusiness ?? false,
          isPrivate: meta?.isPrivate ?? false,
          discoveryReason: `${searchType}: ${searchQuery.slice(0, 200)}`,
          rawMetadataJson: {
            searchTitle: discovered.searchTitle,
            searchSnippet: discovered.searchSnippet,
            allEmails: meta?.emails ?? [],
            allPhones: meta?.phones ?? [],
            allLocationClues: meta?.locationClues ?? [],
            ogData: meta?.rawOg ?? {},
          },
          processingStatus: "pending" as const,
          textHash: hash,
        };

        let insertedId: number | null = null;
        try {
          const rows = await db
            .insert(rawInstagramProfiles)
            .values(insertValues)
            .onConflictDoNothing({
              target: [rawInstagramProfiles.tenantId, rawInstagramProfiles.instagramHandle],
            })
            .returning({ id: rawInstagramProfiles.id });

          if (rows.length > 0) {
            insertedId = rows[0].id;
            profilesInserted++;
            log.info({ handle, rawProfileId: insertedId }, "Inserted raw Instagram profile");
          } else {
            log.debug({ handle }, "Profile already exists (duplicate), skipping");
            // Do NOT re-queue duplicates for scrub — they've already been processed
            continue;
          }
        } catch (dbErr) {
          log.warn({ error: (dbErr as Error).message, handle }, "DB insert failed, continuing");
          continue;
        }

        // Queue newly inserted profile for the scrub worker
        if (insertedId) {
          try {
            await scrubQueue.add(
              "scrub",
              { tenantId, rawProfileId: insertedId, discoveryRunId },
              { jobId: `ig-scrub-${insertedId}-${Date.now()}` },
            );
            log.debug({ rawProfileId: insertedId, handle }, "Queued for scrub worker");
          } catch (qErr) {
            log.warn({ error: (qErr as Error).message, handle }, "Failed to queue for scrub");
          }
        }
      } catch (profileErr) {
        // Never crash on individual profile failure
        log.warn(
          { error: (profileErr as Error).message, handle: discovered.handle },
          "Failed to process profile, continuing",
        );
      }
    }

    // ── Phase 3: Mark run completed ──────────────────────────────────
    await markDiscoveryDone(discoveryRunId, "completed", profilesInserted);
    await job.updateProgress(100);

    log.info(
      { discoveryRunId, searchQuery, handlesFound: totalHandlesFound, profilesInserted },
      "Instagram discovery job complete",
    );

    return { discoveryRunId, profilesFound: totalHandlesFound, profilesInserted };

  } catch (err) {
    log.error(
      { discoveryRunId, error: (err as Error).message, stack: (err as Error).stack },
      "Instagram discovery job failed",
    );

    // Mark as failed (swallow DB errors here)
    await markDiscoveryDone(discoveryRunId, "failed", profilesInserted, (err as Error).message);

    throw err;
  }
}

// ─── Discovery run status updater ──────────────────────────────────────────

async function markDiscoveryDone(
  discoveryRunId: number,
  status: "completed" | "failed",
  profilesFound: number,
  errorMessage?: string,
): Promise<void> {
  try {
    await db
      .update(instagramDiscoveryRuns)
      .set({
        status,
        completedAt: new Date(),
        profilesFound,
        ...(errorMessage ? { errorMessage: errorMessage.slice(0, 2000) } : {}),
      })
      .where(eq(instagramDiscoveryRuns.id, discoveryRunId));
  } catch (err) {
    log.warn({ error: (err as Error).message }, "Failed to update discovery run status");
  }
}
