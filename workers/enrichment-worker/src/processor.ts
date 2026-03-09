import { Job } from "bullmq";
import { db } from "@alh/db";
import { qualifiedLeads, rawLeads, leadResolutionLog } from "@alh/db";
import { eq, and } from "drizzle-orm";
import { logger } from "@alh/observability";
import type { LeadEnrichmentJobData } from "@alh/queues";
import http from "node:http";
import https from "node:https";

const log = logger.child({ module: "enrichment-processor" });

const USER_AGENT = "Mozilla/5.0 (compatible; LeadPulseLab/1.0)";

// ─── Utility helpers ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polite delay between external requests (1-2 seconds). */
async function politeDelay(): Promise<void> {
  const delay = 1000 + Math.random() * 1000;
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
const URL_RE = /https?:\/\/[^\s"'<>)}\]]+/g;
const COMPANY_INDICATORS = /(?:CEO|CTO|COO|founder|co-founder|owner|manager|director|president|VP)\s+(?:of|at|@)\s+([A-Z][A-Za-z0-9 &.\-]+)/gi;
const JOB_TITLE_RE = /(?:I(?:'m| am) (?:a |an |the )?)([\w\s]+?)(?:\s+at\s+|\s+for\s+|\.|,|\s*$)/gi;

// ─── Resolution step runner ─────────────────────────────────────────────────

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

// ─── Step implementations ───────────────────────────────────────────────────

interface ProfileData {
  displayName?: string;
  bio?: string;
  links?: string[];
}

async function stepProfileExtraction(
  platform: string,
  profileUrl: string | null,
  profileName: string | null
): Promise<Record<string, unknown>> {
  if (!profileName && !profileUrl) return {};

  const result: ProfileData = {};

  if (platform === "reddit" && profileName) {
    const username = profileName.replace(/^u\//, "").replace(/^\/u\//, "");
    await politeDelay();
    try {
      const { status, body } = await httpGet(`https://www.reddit.com/user/${username}/about.json`);
      if (status === 200) {
        const json = JSON.parse(body);
        const data = json?.data;
        if (data) {
          result.displayName = data.subreddit?.title || data.name || undefined;
          result.bio = data.subreddit?.public_description || data.subreddit?.description || undefined;
          // Extract any URLs from the bio
          if (result.bio) {
            const urls = result.bio.match(URL_RE);
            if (urls) result.links = urls;
          }
        }
      }
    } catch {
      // Non-fatal
    }
  }

  if (platform === "quora" && profileUrl) {
    await politeDelay();
    try {
      const { status, body } = await httpGet(profileUrl);
      if (status === 200) {
        // Best-effort bio extraction from HTML
        const bioMatch = body.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
        if (bioMatch) result.bio = bioMatch[1];
        const nameMatch = body.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        if (nameMatch) result.displayName = nameMatch[1];
      }
    } catch {
      // Non-fatal
    }
  }

  return Object.keys(result).length > 0 ? { profile: result } : {};
}

interface BioAnalysis {
  emails: string[];
  phones: string[];
  urls: string[];
  companies: string[];
  jobTitles: string[];
}

function stepBioLinkAnalysis(bio: string | undefined, links: string[] | undefined): Record<string, unknown> {
  if (!bio && (!links || links.length === 0)) return {};

  const text = [bio ?? "", ...(links ?? [])].join(" ");
  const analysis: BioAnalysis = {
    emails: [...new Set(text.match(EMAIL_RE) ?? [])],
    phones: [...new Set(text.match(PHONE_RE) ?? [])],
    urls: [...new Set(text.match(URL_RE) ?? [])],
    companies: [],
    jobTitles: [],
  };

  // Extract company names
  let companyMatch: RegExpExecArray | null;
  COMPANY_INDICATORS.lastIndex = 0;
  while ((companyMatch = COMPANY_INDICATORS.exec(text)) !== null) {
    analysis.companies.push(companyMatch[1].trim());
  }

  // Extract job titles
  let titleMatch: RegExpExecArray | null;
  JOB_TITLE_RE.lastIndex = 0;
  while ((titleMatch = JOB_TITLE_RE.exec(text)) !== null) {
    analysis.jobTitles.push(titleMatch[1].trim());
  }

  const hasData =
    analysis.emails.length > 0 ||
    analysis.phones.length > 0 ||
    analysis.companies.length > 0 ||
    analysis.jobTitles.length > 0;

  return hasData ? { bioAnalysis: analysis } : {};
}

interface CrossPlatformProfile {
  platform: string;
  url: string;
  exists: boolean;
}

async function stepCrossPlatformSearch(username: string | null): Promise<Record<string, unknown>> {
  if (!username) return {};

  // Clean username
  const clean = username.replace(/^u\//, "").replace(/^\/u\//, "").replace(/^@/, "").trim();
  if (!clean || clean.length < 2) return {};

  const platforms = [
    { name: "reddit", url: `https://www.reddit.com/user/${clean}` },
    { name: "github", url: `https://github.com/${clean}` },
    { name: "twitter", url: `https://twitter.com/${clean}` },
  ];

  const matches: CrossPlatformProfile[] = [];

  for (const p of platforms) {
    await politeDelay();
    try {
      const { status } = await httpGet(p.url);
      matches.push({ platform: p.name, url: p.url, exists: status === 200 });
    } catch {
      matches.push({ platform: p.name, url: p.url, exists: false });
    }
  }

  const found = matches.filter((m) => m.exists);
  return found.length > 0 ? { crossPlatformProfiles: found } : {};
}

interface WebsiteDiscovery {
  emails: string[];
  phones: string[];
  companyName?: string;
}

async function stepWebsiteEmailDiscovery(urls: string[]): Promise<Record<string, unknown>> {
  if (!urls || urls.length === 0) return {};

  const discovery: WebsiteDiscovery = { emails: [], phones: [] };

  // Only check first 3 URLs to be polite
  for (const url of urls.slice(0, 3)) {
    // Skip social media URLs we already handle
    if (/reddit\.com|twitter\.com|github\.com|quora\.com/i.test(url)) continue;

    await politeDelay();
    try {
      const { status, body } = await httpGet(url);
      if (status !== 200) continue;

      // Extract emails
      const emails = body.match(EMAIL_RE) ?? [];
      discovery.emails.push(...emails);

      // Extract phones
      const phones = body.match(PHONE_RE) ?? [];
      discovery.phones.push(...phones);

      // Try to find company name from title tag
      const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && !discovery.companyName) {
        discovery.companyName = titleMatch[1].trim().split(/[|\-–—]/)[0].trim();
      }

      // Look for a contact page link and follow it
      const contactPageMatch = body.match(/href=["']([^"']*(?:contact|about)[^"']*)["']/i);
      if (contactPageMatch) {
        const contactUrl = contactPageMatch[1].startsWith("http")
          ? contactPageMatch[1]
          : new URL(contactPageMatch[1], url).toString();

        await politeDelay();
        try {
          const contactRes = await httpGet(contactUrl);
          if (contactRes.status === 200) {
            const contactEmails = contactRes.body.match(EMAIL_RE) ?? [];
            discovery.emails.push(...contactEmails);
            const contactPhones = contactRes.body.match(PHONE_RE) ?? [];
            discovery.phones.push(...contactPhones);
          }
        } catch {
          // Non-fatal
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // Dedupe
  discovery.emails = [...new Set(discovery.emails)];
  discovery.phones = [...new Set(discovery.phones)];

  // Try common email patterns if we have a name and domain
  // (done inside caller based on combined data)

  const hasData = discovery.emails.length > 0 || discovery.phones.length > 0 || discovery.companyName;
  return hasData ? { websiteDiscovery: discovery } : {};
}

function stepPhoneDiscovery(allText: string): Record<string, unknown> {
  const phones = [...new Set(allText.match(PHONE_RE) ?? [])];
  return phones.length > 0 ? { phones } : {};
}

// ─── Qualification decision ─────────────────────────────────────────────────

interface EnrichmentAccumulator {
  displayName?: string;
  bio?: string;
  emails: string[];
  phones: string[];
  websites: string[];
  companies: string[];
  jobTitles: string[];
  crossPlatformProfiles: CrossPlatformProfile[];
  companyFromWebsite?: string;
}

function computeIdentityConfidence(acc: EnrichmentAccumulator): number {
  let score = 0;
  if (acc.displayName) score += 20;     // Real name found
  if (acc.emails.length > 0) score += 25; // Email found
  if (acc.phones.length > 0) score += 20; // Phone found
  if (acc.websites.length > 0) score += 10; // Website found
  if (acc.crossPlatformProfiles.length > 0) score += 15; // Cross-platform match
  if (acc.companies.length > 0 || acc.companyFromWebsite) score += 10; // Company found
  if (acc.bio) score += 5;              // Has bio/description
  return Math.min(score, 100);
}

function computeResolutionStatus(acc: EnrichmentAccumulator, confidence: number): string {
  const hasEmail = acc.emails.length > 0;
  const hasPhone = acc.phones.length > 0;
  const hasCrossPlatform = acc.crossPlatformProfiles.length > 0;
  const hasProfile = !!acc.displayName || !!acc.bio;

  // Has verified email + strong signal
  if (hasEmail && confidence >= 50) return "qualified";
  // Has email OR phone + some identity
  if ((hasEmail || hasPhone) && (hasProfile || hasCrossPlatform)) return "qualified";
  // Has email or phone alone
  if (hasEmail) return "email_found";
  if (hasPhone) return "phone_found";
  // Has profile + cross-platform match but no direct contact
  if (hasProfile && hasCrossPlatform) return "partial_inventory";
  // Has only profile data
  if (hasProfile) return "identity_candidate";
  // Nothing useful resolved
  return "partial_inventory";
}

// ─── Main processor ─────────────────────────────────────────────────────────

export async function processLeadEnrichment(job: Job<LeadEnrichmentJobData>) {
  const { qualifiedLeadId, tenantId } = job.data;

  // Load the qualified lead
  const [lead] = await db
    .select()
    .from(qualifiedLeads)
    .where(and(eq(qualifiedLeads.id, qualifiedLeadId), eq(qualifiedLeads.tenantId, tenantId)))
    .limit(1);

  if (!lead) {
    throw new Error(`Qualified lead not found: ${qualifiedLeadId}`);
  }

  // Load the raw lead for extra context
  const [rawLead] = lead.rawLeadId
    ? await db.select().from(rawLeads).where(eq(rawLeads.id, lead.rawLeadId)).limit(1)
    : [null];

  const profileName = rawLead?.profileName ?? lead.fullName ?? null;
  const platform = lead.platform;
  const profileUrl = lead.profileUrl ?? rawLead?.profileUrl ?? null;

  log.info({ qualifiedLeadId, platform, profileName }, "Starting identity resolution pipeline");

  const acc: EnrichmentAccumulator = {
    emails: [],
    phones: [],
    websites: [],
    companies: [],
    jobTitles: [],
    crossPlatformProfiles: [],
  };

  // Collect all text for phone scanning later
  let allText = rawLead?.rawText ?? "";

  // ─── Step 1: Profile Extraction ────────────────────────────────────────
  const step1 = await runStep("profile_extraction", () =>
    stepProfileExtraction(platform, profileUrl, profileName)
  );

  if (step1.output.profile) {
    const profile = step1.output.profile as ProfileData;
    acc.displayName = profile.displayName;
    acc.bio = profile.bio;
    if (profile.links) acc.websites.push(...profile.links);
    if (profile.bio) allText += " " + profile.bio;
  }

  await logStep(tenantId, qualifiedLeadId, step1);

  // Update status
  if (step1.stepStatus === "success") {
    await db
      .update(qualifiedLeads)
      .set({ resolutionStatus: "profile_extracted" })
      .where(eq(qualifiedLeads.id, qualifiedLeadId));
  }

  // ─── Step 2: Bio/Link Analysis ─────────────────────────────────────────
  const step2 = await runStep("bio_link_analysis", async () =>
    stepBioLinkAnalysis(acc.bio, acc.websites)
  );

  if (step2.output.bioAnalysis) {
    const analysis = step2.output.bioAnalysis as BioAnalysis;
    acc.emails.push(...analysis.emails);
    acc.phones.push(...analysis.phones);
    acc.websites.push(...analysis.urls);
    acc.companies.push(...analysis.companies);
    acc.jobTitles.push(...analysis.jobTitles);
  }

  await logStep(tenantId, qualifiedLeadId, step2);

  if (acc.emails.length > 0 || acc.companies.length > 0) {
    await db
      .update(qualifiedLeads)
      .set({ resolutionStatus: "identity_candidate" })
      .where(eq(qualifiedLeads.id, qualifiedLeadId));
  }

  // ─── Step 3: Cross-Platform Search ─────────────────────────────────────
  const step3 = await runStep("cross_platform_search", () =>
    stepCrossPlatformSearch(profileName)
  );

  if (step3.output.crossPlatformProfiles) {
    acc.crossPlatformProfiles = step3.output.crossPlatformProfiles as CrossPlatformProfile[];
  }

  await logStep(tenantId, qualifiedLeadId, step3);

  // ─── Step 4: Website/Email Discovery ───────────────────────────────────
  // Dedupe websites before scanning
  const uniqueWebsites = [...new Set(acc.websites)];

  const step4 = await runStep("website_email_discovery", () =>
    stepWebsiteEmailDiscovery(uniqueWebsites)
  );

  if (step4.output.websiteDiscovery) {
    const disco = step4.output.websiteDiscovery as WebsiteDiscovery;
    acc.emails.push(...disco.emails);
    acc.phones.push(...disco.phones);
    if (disco.companyName) acc.companyFromWebsite = disco.companyName;
    // Add website text to allText for phone scanning
    allText += " " + disco.emails.join(" ") + " " + disco.phones.join(" ");
  }

  await logStep(tenantId, qualifiedLeadId, step4);

  if (acc.emails.length > 0) {
    await db
      .update(qualifiedLeads)
      .set({ resolutionStatus: "contact_candidate" })
      .where(eq(qualifiedLeads.id, qualifiedLeadId));
  }

  // ─── Step 5: Phone Discovery ───────────────────────────────────────────
  // Also scan the raw lead contact_hint
  if (rawLead?.contactHint) allText += " " + rawLead.contactHint;
  if (lead.contactMethod) allText += " " + lead.contactMethod;

  const step5 = await runStep("phone_discovery", async () => stepPhoneDiscovery(allText));

  if (step5.output.phones) {
    acc.phones.push(...(step5.output.phones as string[]));
  }

  await logStep(tenantId, qualifiedLeadId, step5);

  // ─── Step 6: Qualification Decision ────────────────────────────────────
  // Dedupe all collected data
  acc.emails = [...new Set(acc.emails)];
  acc.phones = [...new Set(acc.phones)];
  acc.websites = [...new Set(acc.websites)];
  acc.companies = [...new Set(acc.companies)];

  const identityConfidence = computeIdentityConfidence(acc);
  const resolutionStatus = computeResolutionStatus(acc, identityConfidence);

  const step6 = await runStep("qualification_decision", async () => ({
    identityConfidence,
    resolutionStatus,
    emailCount: acc.emails.length,
    phoneCount: acc.phones.length,
    crossPlatformCount: acc.crossPlatformProfiles.length,
  }));

  await logStep(tenantId, qualifiedLeadId, step6);

  // ─── Step 7: Update qualified_leads record ─────────────────────────────
  const primaryEmail = acc.emails[0] ?? null;
  const primaryPhone = acc.phones[0] ?? null;
  const primaryWebsite = acc.websites.find((u) => !/reddit|twitter|github|quora/i.test(u)) ?? null;
  const resolvedCompany = acc.companyFromWebsite ?? acc.companies[0] ?? null;
  const resolvedName = acc.displayName ?? lead.fullName;

  // Apply score caps based on contact data (CRITICAL PIPELINE RULE)
  // No contact data → cap at 60, profile only → cap at 75, direct contact → full score
  let cappedScore = lead.leadScore ?? 0;
  if (!primaryEmail && !primaryPhone) {
    // No contact data — cap at 60 (nurture max)
    cappedScore = Math.min(cappedScore, 60);
  } else if (!primaryEmail && primaryPhone) {
    // Phone but no email — allow up to 75
    cappedScore = Math.min(cappedScore, 75);
  }
  // If email found, full score allowed

  const step7 = await runStep("update_qualified_lead", async () => {
    await db
      .update(qualifiedLeads)
      .set({
        resolutionStatus,
        identityConfidence,
        resolvedEmail: primaryEmail,
        resolvedPhone: primaryPhone,
        resolvedWebsite: primaryWebsite,
        resolvedCompany: resolvedCompany,
        resolvedLocation: lead.resolvedLocation, // preserve existing
        crossPlatformProfilesJson: acc.crossPlatformProfiles,
        resolutionAttemptsCount: (lead.resolutionAttemptsCount ?? 0) + 1,
        lastResolutionAt: new Date(),
        fullName: resolvedName ?? lead.fullName,
        companyName: resolvedCompany ?? lead.companyName,
        emailVerified: !!primaryEmail,
        phoneVerified: !!primaryPhone,
        leadScore: cappedScore,
        updatedAt: new Date(),
      })
      .where(eq(qualifiedLeads.id, qualifiedLeadId));

    return {
      resolutionStatus,
      identityConfidence,
      email: primaryEmail,
      phone: primaryPhone,
      website: primaryWebsite,
      company: resolvedCompany,
    };
  });

  await logStep(tenantId, qualifiedLeadId, step7);

  log.info(
    {
      qualifiedLeadId,
      resolutionStatus,
      identityConfidence,
      emailFound: !!primaryEmail,
      phoneFound: !!primaryPhone,
      crossPlatformMatches: acc.crossPlatformProfiles.length,
    },
    "Identity resolution pipeline complete"
  );

  return {
    qualifiedLeadId,
    resolutionStatus,
    identityConfidence,
  };
}

// ─── Resolution log helper ──────────────────────────────────────────────────

async function logStep(
  tenantId: number,
  qualifiedLeadId: number,
  result: StepResult
): Promise<void> {
  try {
    await db.insert(leadResolutionLog).values({
      tenantId,
      qualifiedLeadId,
      stepName: result.stepName,
      stepStatus: result.stepStatus,
      outputDataJson: result.output,
      durationMs: result.durationMs,
      errorMessage: result.error ?? null,
    });
  } catch (err) {
    log.warn({ error: (err as Error).message }, "Failed to write resolution log entry");
  }
}
