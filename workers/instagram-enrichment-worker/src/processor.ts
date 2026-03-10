import { Job } from "bullmq";
import {
  db,
  instagramProfileCandidates,
  instagramContactCandidates,
  instagramVerificationRuns,
  instagramLeadScores,
} from "@alh/db";
import { eq, and } from "drizzle-orm";
import type { InstagramEnrichmentJobData } from "@alh/queues";
import { logger } from "@alh/observability";
import dns from "node:dns";
import { promisify } from "node:util";
import http from "node:http";
import https from "node:https";

const resolveMx = promisify(dns.resolveMx);

const log = logger.child({ module: "instagram-enrichment-processor" });

// ─── Constants ───────────────────────────────────────────────────────────────

const MX_TIMEOUT_MS = 5_000;
const HTTP_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 500 * 1024; // 500KB
const POLITE_DELAY_MIN_MS = 2_000;
const POLITE_DELAY_MAX_MS = 3_000;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
];

// ─── Regex patterns ──────────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const SOCIAL_LINK_RE = /href=["'](https?:\/\/(?:www\.)?(?:facebook|twitter|x|linkedin|youtube|tiktok|pinterest)\.[a-z]+\/[^"']+)["']/gi;
const CONTACT_PAGE_RE = /href=["']([^"']*(?:contact|about)[^"']*)["']/gi;

// ─── Disposable email domains ────────────────────────────────────────────────

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "tempmail.com", "throwaway.email",
  "yopmail.com", "sharklasers.com", "guerrillamailblock.com", "grr.la",
  "discard.email", "mailnesia.com", "maildrop.cc", "temp-mail.org",
  "fakeinbox.com", "trashmail.com", "10minutemail.com", "getnada.com",
  "mohmal.com", "burnermail.io", "emailondeck.com", "tempail.com",
]);

// ─── Utility helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function politeDelay(): Promise<void> {
  const ms = POLITE_DELAY_MIN_MS + Math.random() * (POLITE_DELAY_MAX_MS - POLITE_DELAY_MIN_MS);
  await sleep(ms);
}

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── HTTP GET with redirect follow, body limit, timeout ──────────────────────

function httpGet(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {}
): Promise<{ status: number; body: string }> {
  const { timeoutMs = HTTP_TIMEOUT_MS, maxBytes = MAX_BODY_BYTES, maxRedirects = 3 } = opts;

  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      return reject(new Error("Too many redirects"));
    }

    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(
      url,
      { headers: { "User-Agent": randomUserAgent() }, timeout: timeoutMs },
      (res) => {
        // Follow redirects
        if (
          (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) &&
          res.headers.location
        ) {
          res.resume(); // Drain the response
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).toString();
          httpGet(redirectUrl, { timeoutMs, maxBytes, maxRedirects: maxRedirects - 1 })
            .then(resolve)
            .catch(reject);
          return;
        }

        let bytesReceived = 0;
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => {
          bytesReceived += chunk.length;
          if (bytesReceived > maxBytes) {
            res.destroy();
            // Resolve with what we have — partial body is fine for extraction
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") });
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") });
        });

        res.on("error", reject);
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`HTTP request timed out after ${timeoutMs}ms`));
    });
  });
}

// ─── Step result tracking ────────────────────────────────────────────────────

interface StepResult {
  stepName: string;
  stepStatus: "success" | "partial" | "skipped" | "failed";
  output: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

async function runStep(
  stepName: string,
  fn: () => Promise<Record<string, unknown>>
): Promise<StepResult> {
  const start = Date.now();
  try {
    const output = await fn();
    const hasOutput = Object.keys(output).length > 0;
    return {
      stepName,
      stepStatus: hasOutput ? "success" : "skipped",
      output,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.warn({ stepName, error: error.message }, "Enrichment step failed, continuing");
    return {
      stepName,
      stepStatus: "failed",
      output: {},
      error: error.message,
      durationMs: Date.now() - start,
    };
  }
}

// ─── Verification run logger ─────────────────────────────────────────────────

async function logVerificationStep(
  tenantId: number,
  candidateId: number,
  result: StepResult
): Promise<void> {
  try {
    await db.insert(instagramVerificationRuns).values({
      tenantId,
      candidateId,
      stepName: result.stepName,
      stepStatus: result.stepStatus,
      outputDataJson: result.output,
      durationMs: result.durationMs,
      errorMessage: result.error ?? null,
    });
  } catch (err) {
    log.warn({ error: (err as Error).message, stepName: result.stepName }, "Failed to write verification log entry");
  }
}

// ─── Step 1: Email MX Verification ───────────────────────────────────────────

interface MxResult {
  email: string;
  verified: boolean;
  isDisposable: boolean;
  hasMx: boolean;
  domain: string;
}

async function verifyEmailMx(email: string): Promise<MxResult> {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const result: MxResult = {
    email,
    verified: false,
    isDisposable: false,
    hasMx: false,
    domain,
  };

  // Check disposable
  if (DISPOSABLE_DOMAINS.has(domain)) {
    result.isDisposable = true;
    return result;
  }

  // MX lookup with timeout
  try {
    const records = await Promise.race([
      resolveMx(domain),
      sleep(MX_TIMEOUT_MS).then(() => {
        throw new Error("MX lookup timed out");
      }),
    ]) as dns.MxRecord[];

    result.hasMx = records.length > 0;
    result.verified = records.length > 0;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    // ENOTFOUND = invalid domain, ENODATA = no MX records
    if (error.message.includes("ENOTFOUND")) {
      log.debug({ email, domain }, "Domain does not exist");
    } else if (error.message.includes("ENODATA")) {
      log.debug({ email, domain }, "No MX records for domain");
    } else {
      log.debug({ email, domain, error: error.message }, "MX lookup failed");
    }
  }

  return result;
}

// ─── Step 2: Website Scrape ──────────────────────────────────────────────────

interface WebsiteScrapeResult {
  emails: string[];
  phones: string[];
  businessName: string | null;
  socialLinks: string[];
  contactPageFound: boolean;
  pagesScraped: number;
}

async function scrapeWebsite(websiteUrl: string): Promise<WebsiteScrapeResult> {
  const result: WebsiteScrapeResult = {
    emails: [],
    phones: [],
    businessName: null,
    socialLinks: [],
    contactPageFound: false,
    pagesScraped: 0,
  };

  // Fetch main page
  const resp = await httpGet(websiteUrl);
  if (resp.status !== 200) {
    log.debug({ websiteUrl, status: resp.status }, "Website returned non-200 status");
    return result;
  }
  result.pagesScraped++;

  const body = resp.body;

  // Extract emails
  const mainEmails = body.match(EMAIL_RE) ?? [];
  result.emails.push(...mainEmails);

  // Extract phones
  const mainPhones = body.match(PHONE_RE) ?? [];
  result.phones.push(...mainPhones);

  // Extract business name from <title>
  const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    result.businessName = titleMatch[1].trim().split(/[|\-\u2013\u2014]/)[0].trim() || null;
  }

  // Fall back to og:site_name or og:title
  if (!result.businessName) {
    const ogSiteName = body.match(/<meta\s+(?:property|name)=["']og:site_name["']\s+content=["']([^"']+)["']/i);
    if (ogSiteName) {
      result.businessName = ogSiteName[1].trim();
    }
  }

  // Extract social links
  let socialMatch: RegExpExecArray | null;
  SOCIAL_LINK_RE.lastIndex = 0;
  while ((socialMatch = SOCIAL_LINK_RE.exec(body)) !== null) {
    result.socialLinks.push(socialMatch[1]);
  }

  // Look for contact/about page and scrape it
  const contactLinks: string[] = [];
  let contactMatch: RegExpExecArray | null;
  CONTACT_PAGE_RE.lastIndex = 0;
  while ((contactMatch = CONTACT_PAGE_RE.exec(body)) !== null) {
    contactLinks.push(contactMatch[1]);
  }

  if (contactLinks.length > 0) {
    result.contactPageFound = true;
    const contactHref = contactLinks[0];
    const contactUrl = contactHref.startsWith("http")
      ? contactHref
      : new URL(contactHref, websiteUrl).toString();

    await politeDelay();

    try {
      const contactResp = await httpGet(contactUrl);
      if (contactResp.status === 200) {
        result.pagesScraped++;
        const contactBody = contactResp.body;

        const contactEmails = contactBody.match(EMAIL_RE) ?? [];
        result.emails.push(...contactEmails);

        const contactPhones = contactBody.match(PHONE_RE) ?? [];
        result.phones.push(...contactPhones);
      }
    } catch (err) {
      log.debug({ contactUrl, error: (err as Error).message }, "Contact page fetch failed");
    }
  }

  // Deduplicate
  result.emails = [...new Set(result.emails.map((e) => e.toLowerCase()))];
  result.phones = [...new Set(result.phones)];
  result.socialLinks = [...new Set(result.socialLinks)];

  return result;
}

// ─── Contact ranking definitions ─────────────────────────────────────────────

interface RankedContact {
  contactType: string;
  contactValue: string;
  source: string;
  isVerified: boolean;
  verificationMethod: string | null;
  verificationResult: string | null;
  priorityRank: number;
}

// ─── Main Processor ──────────────────────────────────────────────────────────

export async function processInstagramEnrichment(job: Job<InstagramEnrichmentJobData>) {
  const { tenantId, candidateId } = job.data;

  log.info({ tenantId, candidateId, jobId: job.id }, "Starting instagram enrichment");

  // ── Fetch candidate ────────────────────────────────────────────────────────

  const candidates = await db
    .select()
    .from(instagramProfileCandidates)
    .where(
      and(
        eq(instagramProfileCandidates.id, candidateId),
        eq(instagramProfileCandidates.tenantId, tenantId)
      )
    )
    .limit(1);

  const candidate = candidates[0];
  if (!candidate) {
    throw new Error(`Candidate not found: id=${candidateId} tenant=${tenantId}`);
  }

  log.info(
    { candidateId, handle: candidate.instagramHandle, tenantId },
    "Loaded candidate for enrichment"
  );

  // Accumulators — using mutable container so closures can write to it
  const allContacts: RankedContact[] = [];
  const state = {
    bioEmailVerified: false,
    anyEmailVerified: false,
    anyPhoneFound: false,
    websiteScrapeData: null as WebsiteScrapeResult | null,
    websiteScrapeFailed: false,
  };

  // ── Step 1: Email MX Verification ──────────────────────────────────────────

  const step1 = await runStep("email_mx_verification", async () => {
    if (!candidate.normalizedEmail) {
      return {};
    }

    const mxResult = await verifyEmailMx(candidate.normalizedEmail);

    if (mxResult.verified) {
      state.bioEmailVerified = true;
      state.anyEmailVerified = true;

      allContacts.push({
        contactType: "email",
        contactValue: candidate.normalizedEmail,
        source: "bio",
        isVerified: true,
        verificationMethod: "dns_mx",
        verificationResult: "pass",
        priorityRank: 1, // Verified email = priority 1
      });
    } else if (!mxResult.isDisposable) {
      // Bio email exists but unverified — still record as priority 2
      allContacts.push({
        contactType: "email",
        contactValue: candidate.normalizedEmail,
        source: "bio",
        isVerified: false,
        verificationMethod: "dns_mx",
        verificationResult: mxResult.isDisposable ? "disposable" : "no_mx",
        priorityRank: 2, // Bio email (unverified) = priority 2
      });
    }

    return {
      email: mxResult.email,
      domain: mxResult.domain,
      verified: mxResult.verified,
      isDisposable: mxResult.isDisposable,
      hasMx: mxResult.hasMx,
    };
  });
  await logVerificationStep(tenantId, candidateId, step1);

  // ── Step 2: Website Scrape ─────────────────────────────────────────────────

  const step2 = await runStep("website_scrape", async () => {
    if (!candidate.websiteUrl) {
      return {};
    }

    await politeDelay();

    try {
      state.websiteScrapeData = await scrapeWebsite(candidate.websiteUrl);
    } catch (err) {
      state.websiteScrapeFailed = true;
      throw err; // runStep catches this
    }

    const scrape = state.websiteScrapeData;

    // Process website emails — verify each via MX
    for (const email of scrape.emails) {
      // Skip if it's the same as bio email (already processed)
      if (email.toLowerCase() === candidate.normalizedEmail?.toLowerCase()) {
        continue;
      }

      const mxResult = await verifyEmailMx(email);
      if (mxResult.verified) {
        state.anyEmailVerified = true;
        allContacts.push({
          contactType: "email",
          contactValue: email,
          source: "website",
          isVerified: true,
          verificationMethod: "dns_mx",
          verificationResult: "pass",
          priorityRank: 3, // Website email = priority 3
        });
      } else if (!mxResult.isDisposable) {
        allContacts.push({
          contactType: "email",
          contactValue: email,
          source: "website",
          isVerified: false,
          verificationMethod: "dns_mx",
          verificationResult: "no_mx",
          priorityRank: 3,
        });
      }
    }

    // Process website phones
    for (const phone of scrape.phones) {
      state.anyPhoneFound = true;
      allContacts.push({
        contactType: "phone",
        contactValue: phone,
        source: "website",
        isVerified: false,
        verificationMethod: null,
        verificationResult: null,
        priorityRank: 5, // Website phone = priority 5
      });
    }

    return {
      emailsFound: scrape.emails.length,
      phonesFound: scrape.phones.length,
      businessName: scrape.businessName,
      socialLinksFound: scrape.socialLinks.length,
      contactPageFound: scrape.contactPageFound,
      pagesScraped: scrape.pagesScraped,
    };
  });
  await logVerificationStep(tenantId, candidateId, step2);

  // Add bio phone if present (priority 4 — phone from bio)
  if (candidate.normalizedPhone) {
    state.anyPhoneFound = true;
    allContacts.push({
      contactType: "phone",
      contactValue: candidate.normalizedPhone,
      source: "bio",
      isVerified: false,
      verificationMethod: null,
      verificationResult: null,
      priorityRank: 4, // Phone from bio = priority 4
    });
  }

  // ── Step 3: Contact Ranking ────────────────────────────────────────────────

  const step3 = await runStep("contact_ranking", async () => {
    // Sort contacts by priority rank
    allContacts.sort((a, b) => a.priorityRank - b.priorityRank);

    // Deduplicate by contactValue (keep highest priority = lowest rank number)
    const seen = new Set<string>();
    const dedupedContacts: RankedContact[] = [];
    for (const contact of allContacts) {
      const key = `${contact.contactType}:${contact.contactValue.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        dedupedContacts.push(contact);
      }
    }

    // Re-number priority ranks sequentially
    dedupedContacts.forEach((c, i) => {
      c.priorityRank = i + 1;
    });

    // Insert into instagramContactCandidates
    for (const contact of dedupedContacts) {
      try {
        await db.insert(instagramContactCandidates).values({
          tenantId,
          candidateId,
          contactType: contact.contactType,
          contactValue: contact.contactValue,
          source: contact.source,
          isVerified: contact.isVerified,
          verificationMethod: contact.verificationMethod,
          verificationResult: contact.verificationResult,
          priorityRank: contact.priorityRank,
        });
      } catch (err) {
        log.warn(
          { error: (err as Error).message, contactValue: contact.contactValue },
          "Failed to insert contact candidate"
        );
      }
    }

    return {
      totalContacts: dedupedContacts.length,
      verifiedEmails: dedupedContacts.filter((c) => c.contactType === "email" && c.isVerified).length,
      unverifiedEmails: dedupedContacts.filter((c) => c.contactType === "email" && !c.isVerified).length,
      phones: dedupedContacts.filter((c) => c.contactType === "phone").length,
      ranking: dedupedContacts.map((c) => ({
        rank: c.priorityRank,
        type: c.contactType,
        source: c.source,
        verified: c.isVerified,
      })),
    };
  });
  await logVerificationStep(tenantId, candidateId, step3);

  // ── Calculate final scores ─────────────────────────────────────────────────

  const nicheFitScore = candidate.nicheFitScore ?? 0;
  const scrapeResult = state.websiteScrapeData;

  // Contactability score: updated based on what we found
  let contactabilityScore = candidate.contactabilityScore ?? 0;
  if (state.anyEmailVerified) contactabilityScore = Math.max(contactabilityScore, 80);
  else if (allContacts.some((c) => c.contactType === "email")) contactabilityScore = Math.max(contactabilityScore, 60);
  if (state.anyPhoneFound) contactabilityScore = Math.max(contactabilityScore, Math.min(contactabilityScore + 20, 100));
  if (scrapeResult?.contactPageFound) contactabilityScore = Math.max(contactabilityScore, Math.min(contactabilityScore + 10, 100));

  // Verification score: based on MX verify results
  let verificationScore = 0;
  if (state.bioEmailVerified) verificationScore += 50;
  if (state.anyEmailVerified && !state.bioEmailVerified) verificationScore += 30; // website email verified
  if (state.anyPhoneFound) verificationScore += 20;
  if (scrapeResult && !state.websiteScrapeFailed) verificationScore += 15;
  if (scrapeResult?.contactPageFound) verificationScore += 10;
  if (scrapeResult?.businessName) verificationScore += 5;
  verificationScore = Math.min(verificationScore, 100);

  // Weighted average: niche_fit 35%, contactability 35%, verification 30%
  const finalQualificationScore = Math.round(
    nicheFitScore * 0.35 +
    contactabilityScore * 0.35 +
    verificationScore * 0.30
  );

  // Qualification status
  const hasVerifiedContact = state.anyEmailVerified || (state.anyPhoneFound && allContacts.some((c) => c.contactType === "phone"));
  let qualificationStatus: string;
  let newPrequalStatus: string;

  if (hasVerifiedContact && finalQualificationScore >= 50) {
    qualificationStatus = "qualified";
    newPrequalStatus = "qualified";
  } else if (allContacts.length > 0 && finalQualificationScore < 50) {
    qualificationStatus = "partial_inventory";
    newPrequalStatus = "partial_inventory";
  } else if (allContacts.length > 0) {
    // Has some contact but doesn't meet the "verified + >= 50" bar
    qualificationStatus = "partial_inventory";
    newPrequalStatus = "partial_inventory";
  } else {
    qualificationStatus = "discarded";
    newPrequalStatus = "discarded";
  }

  // If website scrape failed, mark for reprocessing instead of discarding
  if (qualificationStatus === "discarded" && state.websiteScrapeFailed && candidate.websiteUrl) {
    qualificationStatus = "partial_inventory";
    newPrequalStatus = "reprocess";
  }

  const scoringNotes = [
    `niche_fit=${nicheFitScore}`,
    `contactability=${contactabilityScore}`,
    `verification=${verificationScore}`,
    `final=${finalQualificationScore}`,
    `bio_email_verified=${state.bioEmailVerified}`,
    `any_email_verified=${state.anyEmailVerified}`,
    `phone_found=${state.anyPhoneFound}`,
    `website_scraped=${!!scrapeResult}`,
    `contact_page=${scrapeResult?.contactPageFound ?? false}`,
    `total_contacts=${allContacts.length}`,
  ].join(", ");

  // ── Insert lead score ──────────────────────────────────────────────────────

  const step4 = await runStep("insert_lead_score", async () => {
    const contactPathRanking = allContacts.map((c) => ({
      rank: c.priorityRank,
      type: c.contactType,
      value: c.contactValue,
      source: c.source,
      verified: c.isVerified,
    }));

    await db.insert(instagramLeadScores).values({
      tenantId,
      candidateId,
      nicheFitScore,
      contactabilityScore,
      verificationScore,
      finalQualificationScore: finalQualificationScore,
      qualificationStatus,
      contactPathRanking,
      scoringNotes,
    });

    return {
      nicheFitScore,
      contactabilityScore,
      verificationScore,
      finalQualificationScore,
      qualificationStatus,
    };
  });
  await logVerificationStep(tenantId, candidateId, step4);

  // ── Update candidate prequal_status ────────────────────────────────────────

  const step5 = await runStep("update_candidate_status", async () => {
    await db
      .update(instagramProfileCandidates)
      .set({
        prequalStatus: newPrequalStatus,
        contactabilityScore,
        updatedAt: new Date(),
      })
      .where(eq(instagramProfileCandidates.id, candidateId));

    return {
      previousStatus: candidate.prequalStatus,
      newStatus: newPrequalStatus,
      contactabilityScore,
    };
  });
  await logVerificationStep(tenantId, candidateId, step5);

  // ── Summary ────────────────────────────────────────────────────────────────

  log.info(
    {
      candidateId,
      handle: candidate.instagramHandle,
      qualificationStatus,
      finalQualificationScore,
      bioEmailVerified: state.bioEmailVerified,
      anyEmailVerified: state.anyEmailVerified,
      anyPhoneFound: state.anyPhoneFound,
      totalContacts: allContacts.length,
    },
    "Instagram enrichment complete"
  );

  return {
    candidateId,
    qualificationStatus,
    finalQualificationScore,
    totalContacts: allContacts.length,
  };
}
