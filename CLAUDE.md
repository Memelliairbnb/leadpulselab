# LeadPulseLab (ai-lead-hunter)

## Development Style
- **Use as many parallel agents as possible for speed.** When building features, fixing bugs, or doing research, always maximize concurrent agent usage. Launch multiple agents simultaneously for independent tasks.
- Move fast. Prefer action over discussion.
- The user is a non-technical business owner — execute directly, don't ask them to run commands.

## Architecture
- **Monorepo**: Turborepo + pnpm@9.15.0 workspaces
- **Package prefix**: `@alh/`
- **Frontend**: Next.js 15 App Router @ `apps/dashboard-web` → Vercel (leadpulselab.com)
- **API**: Fastify @ `apps/lead-api` → Railway
- **Workers**: 6 BullMQ workers + scheduler → Railway
- **Database**: Drizzle ORM + PostgreSQL (Railway), 71 tables
- **Queues**: BullMQ + Redis (Railway), 50 queues
- **AI**: Anthropic Claude via `@alh/ai` package
- **Module system**: CommonJS output (tsconfig.base.json module=commonjs)

## Key Packages
- `@alh/db` — Drizzle schema, migrations, repositories
- `@alh/types` — Shared TypeScript interfaces
- `@alh/queues` — BullMQ queue definitions + Redis connection
- `@alh/ai` — Claude prompt builders + API calls
- `@alh/scoring` — Lead scoring engine
- `@alh/config` — Vertical templates (credit repair, etc.)
- `@alh/source-adapters` — Reddit, Google Search, etc.
- `@alh/observability` — Pino logger

## Build
- All packages output to `dist/` (main: `./dist/index.js`)
- `pnpm turbo build` builds everything
- Docker builds use 2-stage pattern (build + runner)

## Tenant #1
- **Memelli** (slug: memelli, plan: pro, vertical: credit_repair)
- Admin: admin@memelli.com (user id 1, tenant id 1)

## Railway Services
- lead-api, ingestion-worker, ai-analysis-worker, discovery-worker, scrubber-worker, outreach-worker, scheduler
- Postgres + Redis

## API Keys Needed (set via Railway dashboard)
- `ANTHROPIC_API_KEY` → ai-analysis-worker, outreach-worker
- `GOOGLE_CUSTOM_SEARCH_API_KEY` + `GOOGLE_CUSTOM_SEARCH_CX` → discovery-worker
- `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` → discovery-worker
