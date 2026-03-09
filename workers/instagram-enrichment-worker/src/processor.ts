import { Job } from "bullmq";
import { db } from "@alh/db";
import { sql } from "drizzle-orm";
import { logger } from "@alh/observability";
import type { InstagramEnrichmentJobData } from "@alh/queues";
import http from "node:http";
import https from "node:https";
import { resolveMx } from "node:dns/promises";

const log = logger.child({ module: "instagram-enrichment-processor" });

const USER_AGENT = "Mozilla/5.0 (compatible; LeadPulseLab/1.0)";

// ─── Utility helpers ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polite delay between external requests (2-3 seconds). */
async function politeDelay(): Promise<void> {
  const delay = 2000 + Math.random() * 1000;
  await sleep(delay);
}

/** Simple HTTP GET that returns { status, body } or throws. */
function httpGet(url: string, timeoutMs = 10_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": USER_AGENT }, timeout: timeoutMs }, (res) => {
      // Follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        httpGet(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
  });
}

// ─── Regex patterns ─────────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const CONTACT_PAGE_RE = /href=["']([^"']*(?:contact|about)[^"']*)["']/gi;
const ADDRESS_RE = /\d{1,5}\s[\w\s]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place)[.,]?\s*(?:[A-Z]{2})?\s*\d{5}(?:-\d{4})?/gi;

// ─── Disposable email blocklist ─────────────────────────────────────────────

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "tempmail.com", "throwaway.email",
  "yopmail.com", "sharklasers.com", "guerrillamailblock.com", "grr.la",
  "discard.email", "mailnesia.com", "maildrop.cc", "temp-mail.org",
  "fakeinbox.com", "trashmail.com", "10minutemail.com", "getnada.com",
  "mohmal.com", "burnermail.io", "emailondeck.com", "tempail.com",
]);

// ─── Valid US/CA area codes (abbreviated set of valid ones) ─────────────────

const VALID_AREA_CODES = new Set([
  // Major US area codes
  "201","202","203","205","206","207","208","209","210","212","213","214","215",
  "216","217","218","219","220","223","224","225","228","229","231","234","239",
  "240","248","251","252","253","254","256","260","262","267","269","270","272",
  "276","278","281","283","301","302","303","304","305","307","308","309","310",
  "312","313","314","315","316","317","318","319","320","321","323","325","327",
  "330","331","332","334","336","337","339","340","341","346","347","351","352",
  "360","361","364","380","385","386","401","402","404","405","406","407","408",
  "409","410","412","413","414","415","417","419","423","424","425","430","432",
  "434","435","440","442","443","445","458","463","469","470","475","478","479",
  "480","484","501","502","503","504","505","507","508","509","510","512","513",
  "515","516","517","518","520","530","531","534","539","540","541","551","559",
  "561","562","563","564","567","570","571","573","574","575","580","585","586",
  "601","602","603","605","606","607","608","609","610","612","614","615","616",
  "617","618","619","620","623","626","628","629","630","631","636","641","646",
  "650","651","657","659","660","661","662","667","669","678","680","681","682",
  "689","701","702","703","704","706","707","708","712","713","714","715","716",
  "717","718","719","720","724","725","726","727","730","731","732","734","737",
  "740","743","747","754","757","760","762","763","764","765","769","770","772",
  "773","774","775","779","781","785","786","801","802","803","804","805","806",
  "808","810","812","813","814","815","816","817","818","820","828","830","831",
  "832","835","843","845","847","848","850","854","856","857","858","859","860",
  "862","863","864","865","870","872","878","901","903","904","906","907","908",
  "909","910","912","913","914","915","916","917","918","919","920","925","928",
  "929","930","931","934","936","937","938","940","941","943","945","947","949",
  "951","952","954","956","959","970","971","972","973","975","978","979","980",
  "984","985","986","989",
  // Major Canadian area codes
  "204","226","236","249","250","289","306","343","365","403","416","418","431",
  "437","438","450","506","514","519","548","579","581","587","604","613","639",
  "647","705","709","778","780","807","819","825","867","873","902","905",
]);

// ─── Step result tracking ───────────────────────────────────────────────────

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
    return {
      stepName,
      stepStatus: Object.keys(output).length > 0 ? "success" : "skipped",
      output,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const error = err as Error;
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

// ─── DNS MX check ───────────────────────────────────────────────────────────

async function checkMxRecord(email: string): Promise<boolean> {
  try {
    const domain = email.split("@")[1];
    const records = await resolveMx(domain);
    return records.length > 0;
  } catch {
    return false;
  }
}

function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return DISPOSABLE_DOMAINS.has(domain);
}

// ─── Phone validation ───────────────────────────────────────────────────────

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function isValidPhone(phone: string): { valid: boolean; areaCode: string } {
  const digits = normalizePhoneDigits(phone);
  // Strip leading 1 for US/CA
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length < 10 || normalized.length > 15) {
    return { valid: false, areaCode: "" };
  }
  const areaCode = normalized.slice(0, 3);
  return { valid: VALID_AREA_CODES.has(areaCode), areaCode };
}

// ─── Website scraping ───────────────────────────────────────────────────────

interface WebsiteScrapeResult {
  emails: string[];
  phones: string[];
  businessName?: string;
  address?: string;
  contactPageFound: boolean;
}

async function scrapeWebsite(websiteUrl: string): Promise<WebsiteScrapeResult> {
  const result: WebsiteScrapeResult = {
    emails: [],
    phones: [],
    contactPageFound: false,
  };

  // Fetch main page
  await politeDelay();
  let mainBody: string;
  try {
    const resp = await httpGet(websiteUrl);
    if (resp.status !== 200) return result;
    mainBody = resp.body;
  } catch {
    return result;
  }

  // Extract emails from main page
  const mainEmails = mainBody.match(EMAIL_RE) ?? [];
  result.emails.push(...mainEmails);

  // Extract phones from main page
  const mainPhones = mainBody.match(PHONE_RE) ?? [];
  result.phones.push(...mainPhones);

  // Extract business name from <title>
  const titleMatch = mainBody.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    result.businessName = titleMatch[1].trim().split(/[|\-\u2013\u2014]/)[0].trim();
  }

  // Extract address from main page
  const addressMatches = mainBody.match(ADDRESS_RE);
  if (addressMatches && addressMatches.length > 0) {
    result.address = addressMatches[0].trim();
  }

  // Look for contact page links
  const contactLinks: string[] = [];
  let contactMatch: RegExpExecArray | null;
  CONTACT_PAGE_RE.lastIndex = 0;
  while ((contactMatch = CONTACT_PAGE_RE.exec(mainBody)) !== null) {
    contactLinks.push(contactMatch[1]);
  }

  // Fetch first contact/about page found
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
        const contactEmails = contactResp.body.match(EMAIL_RE) ?? [];
        result.emails.push(...contactEmails);

        const contactPhones = contactResp.body.match(PHONE_RE) ?? [];
        result.phones.push(...contactPhones);

        // Try address from contact page too
        if (!result.address) {
          const contactAddresses = contactResp.body.match(ADDRESS_RE);
          if (contactAddresses && contactAddresses.length > 0) {
            result.address = contactAddresses[0].trim();
          }
        }
      }
    } catch {
      // Non-fatal: contact page fetch failed
    }
  }

  // Dedupe
  result.emails = [...new Set(result.emails)];
  result.phones = [...new Set(result.phones)];

  return result;
}

// ─── Verification run logger ────────────────────────────────────────────────

async function logVerificationStep(
  tenantId: number,
  candidateId: number,
  result: StepResult
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO instagram_verification_runs (tenant_id, candidate_id, step_name, step_status, output_data_json, duration_ms, error_message)
      VALUES (${tenantId}, ${candidateId}, ${result.stepName}, ${result.stepStatus}, ${JSON.stringify(result.output)}::jsonb, ${result.durationMs}, ${result.error ?? null})
    `);
  } catch (err) {
    log.warn({ error: (err as Error).message }, "Failed to write verification log entry");
  }
}

// ─── Main processor ─────────────────────────────────────────────────────────

export async function processInstagramEnrichment(job: Job<InstagramEnrichmentJobData>) {
  const { tenantId, candidateId } = job.data;

  // ─── Step 1: Load Candidate ─────────────────────────────────────────────
  const candidateRows = await db.execute(sql`
    SELECT * FROM instagram_profile_candidates WHERE id = ${candidateId} AND tenant_id = ${tenantId} LIMIT 1
  `);

  const rows = candidateRows as unknown as Record<string, unknown>[];
  const candidate = rows?.[0] as Record<string, unknown> | undefined;
  if (!candidate) {
    throw new Error(`Instagram candidate not found: ${candidateId}`);
  }

  log.info(
    { candidateId, handle: candidate.instagram_handle, tenantId },
    "Starting instagram enrichment pipeline"
  );

  // Accumulate resolved data
  let verifiedEmail: string | null = null;
  let emailVerified = false;
  let verifiedPhone: string | null = null;
  let phoneVerified = false;
  let websiteScrape: WebsiteScrapeResult | null = null;
  let websiteScrapeFailed = false;

  // ─── Step 2: Email Verification ─────────────────────────────────────────
  const step2 = await runStep("email_verification", async () => {
    const normalizedEmail = candidate.normalized_email as string | null;
    if (!normalizedEmail) return {};

    // Check disposable
    if (isDisposableEmail(normalizedEmail)) {
      return { email: normalizedEmail, status: "disposable", verified: false };
    }

    // Check MX record
    const hasMx = await checkMxRecord(normalizedEmail);
    if (hasMx) {
      verifiedEmail = normalizedEmail;
      emailVerified = true;
      return { email: normalizedEmail, status: "mx_verified", verified: true };
    }

    return { email: normalizedEmail, status: "no_mx", verified: false };
  });
  await logVerificationStep(tenantId, candidateId, step2);

  // ─── Step 3: Phone Verification ─────────────────────────────────────────
  const step3 = await runStep("phone_verification", async () => {
    const normalizedPhone = candidate.normalized_phone as string | null;
    if (!normalizedPhone) return {};

    const { valid, areaCode } = isValidPhone(normalizedPhone);
    if (valid) {
      verifiedPhone = normalizedPhone;
      phoneVerified = true;
      return { phone: normalizedPhone, status: "basic_verified", areaCode, verified: true };
    }

    return { phone: normalizedPhone, status: "invalid_format", areaCode, verified: false };
  });
  await logVerificationStep(tenantId, candidateId, step3);

  // ─── Step 4: Website Scraping ───────────────────────────────────────────
  const step4 = await runStep("website_scraping", async () => {
    const websiteUrl = candidate.website_url as string | null;
    if (!websiteUrl) return {};

    try {
      websiteScrape = await scrapeWebsite(websiteUrl);
    } catch {
      websiteScrapeFailed = true;
      return { status: "scrape_failed" };
    }

    return {
      emailsFound: websiteScrape.emails.length,
      phonesFound: websiteScrape.phones.length,
      businessName: websiteScrape.businessName ?? null,
      address: websiteScrape.address ?? null,
      contactPageFound: websiteScrape.contactPageFound,
    };
  });
  await logVerificationStep(tenantId, candidateId, step4);

  // ─── Step 5: Resolve Business Identity ──────────────────────────────────
  const step5 = await runStep("resolve_business_identity", async () => {
    // Best name: display_name from Instagram, or business name from website
    const bestName = (candidate.display_name as string | null)
      ?? websiteScrape?.businessName
      ?? null;

    // Best email: verified email from bio, or first email from website
    const bestEmail = verifiedEmail
      ?? (websiteScrape?.emails?.[0] ?? null);
    // If we picked up email from website and haven't verified yet, quick MX check
    if (!verifiedEmail && bestEmail) {
      const hasMx = await checkMxRecord(bestEmail);
      if (hasMx && !isDisposableEmail(bestEmail)) {
        verifiedEmail = bestEmail;
        emailVerified = true;
      }
    }

    // Best phone: verified phone from bio, or first phone from website
    const bestPhone = verifiedPhone
      ?? (websiteScrape?.phones?.[0] ?? null);
    if (!verifiedPhone && bestPhone) {
      const { valid } = isValidPhone(bestPhone);
      if (valid) {
        verifiedPhone = bestPhone;
        phoneVerified = true;
      }
    }

    // Best location
    const bestLocation = (candidate.location_clues as string | null)
      ?? websiteScrape?.address
      ?? null;

    // Category
    const bestCategory = (candidate.category as string | null) ?? null;

    return {
      bestName,
      bestEmail: verifiedEmail,
      bestPhone: verifiedPhone,
      bestLocation,
      bestCategory,
    };
  });
  await logVerificationStep(tenantId, candidateId, step5);

  const resolved = step5.output as {
    bestName: string | null;
    bestEmail: string | null;
    bestPhone: string | null;
    bestLocation: string | null;
    bestCategory: string | null;
  };

  // ─── Step 6: Contact Path Ranking ───────────────────────────────────────
  const step6 = await runStep("contact_path_ranking", async () => {
    const contactPaths: Array<{
      contactType: string;
      contactValue: string;
      source: string;
      isVerified: boolean;
      rank: number;
    }> = [];

    if (verifiedEmail) {
      contactPaths.push({
        contactType: "verified_public_email",
        contactValue: verifiedEmail,
        source: emailVerified && candidate.normalized_email ? "bio" : "website",
        isVerified: true,
        rank: 1,
      });
    }

    if (verifiedPhone) {
      contactPaths.push({
        contactType: "verified_public_phone",
        contactValue: verifiedPhone,
        source: phoneVerified && candidate.normalized_phone ? "bio" : "website",
        isVerified: true,
        rank: 2,
      });
    }

    if (websiteScrape?.contactPageFound) {
      const websiteUrl = candidate.website_url as string;
      contactPaths.push({
        contactType: "website_contact_form",
        contactValue: websiteUrl,
        source: "website",
        isVerified: false,
        rank: 3,
      });
    }

    // DM path is always available for Instagram
    const profileUrl = candidate.profile_url as string | null;
    if (profileUrl) {
      contactPaths.push({
        contactType: "dm_path",
        contactValue: profileUrl,
        source: "instagram",
        isVerified: false,
        rank: 4,
      });
    }

    // Insert contact candidates
    for (const cp of contactPaths) {
      await db.execute(sql`
        INSERT INTO instagram_contact_candidates
          (tenant_id, candidate_id, contact_type, contact_value, source, is_verified, verification_method, verification_result, priority_rank)
        VALUES
          (${tenantId}, ${candidateId}, ${cp.contactType}, ${cp.contactValue}, ${cp.source}, ${cp.isVerified},
           ${cp.isVerified ? "automated" : null}, ${cp.isVerified ? "pass" : null}, ${cp.rank})
      `);
    }

    return { contactPaths };
  });
  await logVerificationStep(tenantId, candidateId, step6);

  // ─── Step 7: Final Qualification Score (0-100) ──────────────────────────
  const step7 = await runStep("final_qualification_score", async () => {
    let score = 0;

    if (verifiedEmail) score += 35;
    if (verifiedPhone) score += 25;
    if (websiteScrape?.contactPageFound) score += 15;
    if ((candidate.profile_type as string) === "business") score += 10;
    const nicheFitScore = candidate.niche_fit_score as number | null;
    if (nicheFitScore && nicheFitScore >= 60) score += 10;
    if (resolved.bestLocation) score += 5;

    // Cap at 100
    score = Math.min(score, 100);

    return { finalScore: score };
  });
  await logVerificationStep(tenantId, candidateId, step7);

  const finalScore = (step7.output.finalScore as number) ?? 0;

  // ─── Step 8: Qualification Decision ─────────────────────────────────────
  const step8 = await runStep("qualification_decision", async () => {
    const nicheFitScore = candidate.niche_fit_score as number | null;
    const hasNicheFit = (nicheFitScore ?? 0) > 50;

    let qualStatus: string;

    if (verifiedEmail && verifiedPhone && hasNicheFit) {
      qualStatus = "qualified_lead";
    } else if (verifiedEmail || verifiedPhone) {
      qualStatus = "partial_inventory";
    } else if (websiteScrapeFailed) {
      qualStatus = "reprocess_later";
    } else {
      qualStatus = "discard";
    }

    return { qualificationStatus: qualStatus };
  });
  await logVerificationStep(tenantId, candidateId, step8);

  const qualStatus = step8.output.qualificationStatus as string;

  // ─── Step 9: Insert Final Score ─────────────────────────────────────────
  const step9 = await runStep("insert_lead_score", async () => {
    const nicheFitScore = candidate.niche_fit_score as number ?? 0;
    const contactabilityScore = candidate.contactability_score as number ?? 0;
    const verificationScore = (emailVerified ? 50 : 0) + (phoneVerified ? 50 : 0);

    const contactPaths = (step6.output.contactPaths as Array<Record<string, unknown>>) ?? [];

    await db.execute(sql`
      INSERT INTO instagram_lead_scores
        (tenant_id, candidate_id, niche_fit_score, contactability_score, verification_score,
         final_qualification_score, qualification_status, contact_path_ranking, scoring_notes)
      VALUES
        (${tenantId}, ${candidateId}, ${nicheFitScore}, ${contactabilityScore}, ${verificationScore},
         ${finalScore}, ${qualStatus}, ${JSON.stringify(contactPaths)}::jsonb,
         ${`email_verified=${emailVerified}, phone_verified=${phoneVerified}, website_scraped=${!!websiteScrape}, contact_page=${websiteScrape?.contactPageFound ?? false}`})
    `);

    return { inserted: true, finalScore, qualStatus };
  });
  await logVerificationStep(tenantId, candidateId, step9);

  // ─── Step 10: Create Qualified Lead ─────────────────────────────────────
  const step10 = await runStep("create_qualified_lead", async () => {
    if (qualStatus === "qualified_lead") {
      const bestContactMethod = verifiedEmail
        ? `email:${verifiedEmail}`
        : verifiedPhone
          ? `phone:${verifiedPhone}`
          : (candidate.profile_url as string) ?? "dm";

      const identityConfidence = computeIdentityConfidence(
        emailVerified, phoneVerified, !!websiteScrape, !!resolved.bestName, !!resolved.bestLocation
      );

      await db.execute(sql`
        INSERT INTO qualified_leads
          (tenant_id, full_name, company_name, lead_type, intent_level, lead_score,
           ai_confidence, ai_summary, ai_signals_json,
           platform, profile_url, contact_method, contact_type,
           status, resolution_status, identity_confidence,
           resolved_email, resolved_phone, resolved_website, resolved_company,
           email_verified, phone_verified, needs_review)
        VALUES
          (${tenantId},
           ${resolved.bestName ?? (candidate.display_name as string | null) ?? (candidate.instagram_handle as string)},
           ${resolved.bestName ?? null},
           ${"instagram_lead"},
           ${"high"},
           ${finalScore},
           ${0.85},
           ${`Instagram qualified lead: ${candidate.instagram_handle}. Verified email: ${emailVerified}, verified phone: ${phoneVerified}.`},
           ${JSON.stringify([])}::jsonb,
           ${"instagram"},
           ${(candidate.profile_url as string | null) ?? `https://instagram.com/${candidate.instagram_handle}`},
           ${bestContactMethod},
           ${verifiedEmail ? "email" : verifiedPhone ? "phone" : "dm"},
           ${"new"},
           ${"qualified"},
           ${identityConfidence},
           ${verifiedEmail},
           ${verifiedPhone},
           ${(candidate.website_url as string | null) ?? null},
           ${resolved.bestName ?? null},
           ${emailVerified},
           ${phoneVerified},
           ${true})
      `);

      return { created: true, status: "qualified_lead", leadScore: finalScore };
    }

    if (qualStatus === "partial_inventory") {
      const cappedScore = Math.min(finalScore, 60);
      const bestContactMethod = verifiedEmail
        ? `email:${verifiedEmail}`
        : verifiedPhone
          ? `phone:${verifiedPhone}`
          : (candidate.profile_url as string) ?? "dm";

      const identityConfidence = computeIdentityConfidence(
        emailVerified, phoneVerified, !!websiteScrape, !!resolved.bestName, !!resolved.bestLocation
      );

      await db.execute(sql`
        INSERT INTO qualified_leads
          (tenant_id, full_name, company_name, lead_type, intent_level, lead_score,
           ai_confidence, ai_summary, ai_signals_json,
           platform, profile_url, contact_method, contact_type,
           status, resolution_status, identity_confidence,
           resolved_email, resolved_phone, resolved_website, resolved_company,
           email_verified, phone_verified, needs_review)
        VALUES
          (${tenantId},
           ${resolved.bestName ?? (candidate.display_name as string | null) ?? (candidate.instagram_handle as string)},
           ${resolved.bestName ?? null},
           ${"instagram_lead"},
           ${"medium"},
           ${cappedScore},
           ${0.60},
           ${`Instagram partial inventory: ${candidate.instagram_handle}. Missing full contact verification.`},
           ${JSON.stringify([])}::jsonb,
           ${"instagram"},
           ${(candidate.profile_url as string | null) ?? `https://instagram.com/${candidate.instagram_handle}`},
           ${bestContactMethod},
           ${verifiedEmail ? "email" : verifiedPhone ? "phone" : "dm"},
           ${"new"},
           ${"partial_inventory"},
           ${identityConfidence},
           ${verifiedEmail},
           ${verifiedPhone},
           ${(candidate.website_url as string | null) ?? null},
           ${resolved.bestName ?? null},
           ${emailVerified},
           ${phoneVerified},
           ${true})
      `);

      return { created: true, status: "partial_inventory", leadScore: cappedScore };
    }

    return { created: false, status: qualStatus };
  });
  await logVerificationStep(tenantId, candidateId, step10);

  // ─── Step 11: Log Final Verification Summary ───────────────────────────
  const step11 = await runStep("verification_summary", async () => {
    return {
      candidateId,
      instagramHandle: candidate.instagram_handle,
      qualificationStatus: qualStatus,
      finalScore,
      emailVerified,
      phoneVerified,
      websiteScraped: !!websiteScrape,
      contactPageFound: websiteScrape?.contactPageFound ?? false,
      resolvedName: resolved.bestName,
      resolvedEmail: verifiedEmail,
      resolvedPhone: verifiedPhone,
      resolvedLocation: resolved.bestLocation,
    };
  });
  await logVerificationStep(tenantId, candidateId, step11);

  log.info(
    {
      candidateId,
      qualificationStatus: qualStatus,
      finalScore,
      emailVerified,
      phoneVerified,
    },
    "Instagram enrichment pipeline complete"
  );

  return {
    candidateId,
    qualificationStatus: qualStatus,
    finalScore,
  };
}

// ─── Identity confidence calculator ─────────────────────────────────────────

function computeIdentityConfidence(
  hasEmail: boolean,
  hasPhone: boolean,
  hasWebsite: boolean,
  hasName: boolean,
  hasLocation: boolean
): number {
  let score = 0;
  if (hasEmail) score += 30;
  if (hasPhone) score += 25;
  if (hasWebsite) score += 20;
  if (hasName) score += 15;
  if (hasLocation) score += 10;
  return Math.min(score, 100);
}
