# LeadPulseLab (ai-lead-hunter)

## CRITICAL PIPELINE RULE
**Signal capture is the BEGINNING of the workflow, not the finished product.**

A lead is NOT qualified until:
- Identity resolved with confidence 60+
- Verified email OR verified phone
- Signal confidence above threshold
- Duplicate scrub passed

Everything else is inventory, not a lead. No exceptions.

### What is NOT a lead:
- A visitor ping
- A username
- A profile URL
- A post/comment text
- A page hit

### Resolution stages (every lead must go through):
1. signal_found → raw capture
2. profile_extracted → author/bio/link extraction
3. identity_candidate → cross-platform search
4. contact_candidate → email/phone discovery
5. email_found / phone_found → verification
6. qualified (has contact + identity) OR partial_inventory (missing contact) OR discarded

### Scoring caps (hardcoded):
- No contact data at all → score capped at 60 (nurture max)
- Only profile/username → score capped at 75 (strong max)
- Email or phone verified → full score allowed, can be hot (85+)

### Discussion sources need MORE work, not less:
Quora, Reddit, forums, public groups, complaint sites, comment sections — these sources require the full multi-step identity resolution pipeline. Use maximum agents. Do not stop at signal capture.

## Development Style
- **Use as many parallel agents as possible for speed.** Launch multiple agents simultaneously for independent tasks.
- Move fast. Prefer action over discussion.
- The user is a non-technical business owner — execute directly, don't ask them to run commands.
- **Prefer free sources over paid APIs.** Reddit RSS, Craigslist, public forums, manual entry, CSV import. Only use paid APIs when free alternatives don't exist.
- Agents should crawl slowly and naturally — polite delays (1-2s) between requests.

## Architecture
- **Monorepo**: Turborepo + pnpm@9.15.0 workspaces
- **Package prefix**: `@alh/`
- **Frontend**: Next.js 15 App Router @ `apps/dashboard-web` → Vercel (leadpulselab.com)
- **API**: Fastify @ `apps/lead-api` → Railway
- **Workers**: 7 BullMQ workers + scheduler → Railway
- **Database**: Drizzle ORM + PostgreSQL (Railway)
- **Queues**: BullMQ + Redis (Railway)
- **AI**: Anthropic Claude via `@alh/ai` package
- **Module system**: CommonJS output (tsconfig.base.json module=commonjs)

## Pipeline Flow
```
Source (RSS/scrape/manual/CSV/webhook)
  → raw_lead (ingestion)
  → AI analysis (classification + intent detection)
  → qualified_lead created (resolution_status = signal_found)
  → enrichment-worker (identity resolution)
    → profile extraction
    → cross-platform search
    → website/email/phone discovery
    → identity scoring
    → qualification decision
  → qualified (has contact) | partial_inventory (no contact) | discarded
```

## Key Packages
- `@alh/db` — Drizzle schema, migrations, repositories
- `@alh/types` — Shared TypeScript interfaces
- `@alh/queues` — BullMQ queue definitions + Redis connection
- `@alh/ai` — Claude prompt builders + API calls
- `@alh/scoring` — Lead scoring engine (with contact data caps)
- `@alh/identity-resolution` — 6-step identity resolver
- `@alh/config` — Vertical templates (credit repair, etc.)
- `@alh/source-adapters` — Reddit RSS, Craigslist, forums, reviews, Google Search
- `@alh/observability` — Pino logger

## Workers
- ingestion-worker — raw source processing
- ai-analysis-worker — Claude classification + intent detection
- enrichment-worker — identity resolution pipeline
- discovery-worker — automated source scanning
- scrubber-worker — dedup + data cleaning
- outreach-worker — message generation
- scheduler — cron triggers
- **instagram-discovery-worker** — DuckDuckGo + Instagram profile discovery (free)
- **instagram-scrub-worker** — dedup, normalize, classify, score niche fit + contactability
- **instagram-enrichment-worker** — MX email verify, website scrape, contact ranking, qualification

## Instagram Pipeline (3-Worker)
```
DDGS Search (free) → raw_instagram_profiles
  → Worker 1: Discovery (DuckDuckGo search + Instagram meta scraping)
  → Worker 2: Scrub/Parse/Prequalify (dedup, classify, score)
  → Worker 3: Enrich/Qualify (email MX verify, website scrape, contact ranking)
  → qualified_lead OR partial_inventory OR discard
```
- Queues: instagram_discovery_queue, instagram_scrub_queue, instagram_enrichment_queue
- Scoring: niche_fit (40%) + contactability (30%) + bio_quality (30%)
- Threshold: ≥50 = enrich, ≥30 = partial, <30 = discard
- DDGS Python script for bulk discovery (scripts/ddgs-instagram-discovery.py)
- Free tools: DDGS, Beautiful Soup, DNS MX checks — zero paid APIs

## Build
- All packages output to `dist/` (main: `./dist/index.js`)
- `pnpm turbo build` builds everything
- Docker builds use 2-stage pattern (build + runner)

## Tenant #1
- **Memelli** (slug: memelli, plan: pro, vertical: credit_repair)
- Admin: admin@memelli.com / Memelli2026! (user id 1, tenant id 1)

## Free Sources (priority)
- Reddit RSS feeds (r/CRedit, r/personalfinance, r/Debt, r/FirstTimeHomeBuyer, r/povertyfinance)
- Craigslist services sections
- Public forum scraping
- Yelp/BBB review scraping
- Manual entry + CSV import + Webhook intake

## Railway Services
- lead-api, ingestion-worker, ai-analysis-worker, enrichment-worker, discovery-worker, scrubber-worker, outreach-worker, scheduler
- instagram-discovery-worker, instagram-scrub-worker, instagram-enrichment-worker
- Postgres + Redis

## Open Source Tools (all free)
- **DDGS** — DuckDuckGo Search for Instagram profile discovery (Python)
- **Beautiful Soup / node-html-parser** — HTML parsing for meta tags
- **DNS MX checks** — Free email verification via Node.js dns module
- **Playwright** (planned) — Headless browser for JS-heavy sites
- **Crawl4AI** (planned) — AI-powered data extraction
- **Scrapy** (planned) — Large-scale structured crawling
