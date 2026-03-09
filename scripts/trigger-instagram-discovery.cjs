/**
 * Instagram Discovery Scan — finds credit repair professionals on Instagram
 * using Google site:instagram.com searches across major US cities and keywords.
 */
const postgres = require('/Users/thebooth/ai-lead-hunter/packages/db/node_modules/postgres');
const { Queue } = require('/Users/thebooth/ai-lead-hunter/node_modules/.pnpm/bullmq@5.70.4/node_modules/bullmq');
const IORedis = require('/Users/thebooth/ai-lead-hunter/node_modules/.pnpm/ioredis@5.10.0/node_modules/ioredis');

const DB_URL = 'postgresql://postgres:GLGUwEndhZBYWITgOdRvPNjktGrlsDHh@metro.proxy.rlwy.net:19515/railway';
const REDIS_URL = 'redis://default:OTmPxBXVUQMwnAKCGCHJjqFujRmjHXYp@trolley.proxy.rlwy.net:25744';
const TENANT_ID = 1;

const sql = postgres(DB_URL);

// Major US cities for geo-targeted credit repair searches
const CITIES = [
  'Houston', 'Atlanta', 'Dallas', 'Miami', 'Chicago',
  'Los Angeles', 'Phoenix', 'Philadelphia', 'Charlotte', 'Detroit',
];

// Build search queries: city-specific + general keyword queries
const SEARCH_QUERIES = [
  // City-specific "credit repair" queries
  ...CITIES.map(city => ({
    query: `site:instagram.com "credit repair" "${city}"`,
    category: 'city_credit_repair',
    city,
  })),
  // General keyword queries
  { query: 'site:instagram.com "credit restoration"', category: 'keyword', city: null },
  { query: 'site:instagram.com "credit specialist"', category: 'keyword', city: null },
  { query: 'site:instagram.com "fix your credit"', category: 'keyword', city: null },
  { query: 'site:instagram.com #creditrepair', category: 'hashtag', city: null },
  { query: 'site:instagram.com #creditrestoration', category: 'hashtag', city: null },
  { query: 'site:instagram.com "credit consultant"', category: 'keyword', city: null },
  { query: 'site:instagram.com "FICO score"', category: 'keyword', city: null },
  { query: 'site:instagram.com "debt relief"', category: 'keyword', city: null },
  { query: 'site:instagram.com "credit repair specialist"', category: 'keyword', city: null },
  { query: 'site:instagram.com "credit repair company"', category: 'keyword', city: null },
  { query: 'site:instagram.com "credit repair service"', category: 'keyword', city: null },
  { query: 'site:instagram.com "boost your credit"', category: 'keyword', city: null },
  { query: 'site:instagram.com "credit fix"', category: 'keyword', city: null },
  { query: 'site:instagram.com "credit repair expert"', category: 'keyword', city: null },
  { query: 'site:instagram.com #fixmycredit', category: 'hashtag', city: null },
  { query: 'site:instagram.com #creditscore', category: 'hashtag', city: null },
];

async function ensureTable() {
  console.log('Ensuring instagram_discovery_runs table exists...');
  await sql`
    CREATE TABLE IF NOT EXISTS instagram_discovery_runs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      search_query TEXT NOT NULL,
      search_type VARCHAR(50) NOT NULL DEFAULT 'keyword',
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      results_count INTEGER DEFAULT 0,
      error_message TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    )
  `;
  console.log('Table ready.\n');
}

async function main() {
  console.log('=== Instagram Discovery Scan — Credit Repair Vertical ===');
  console.log(`Total search queries: ${SEARCH_QUERIES.length}\n`);

  // Ensure the table exists
  await ensureTable();

  // Connect to Redis and create queue
  const redisConn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue('instagram_discovery_queue', { connection: redisConn });

  let totalRunsCreated = 0;
  let totalJobsQueued = 0;

  for (let i = 0; i < SEARCH_QUERIES.length; i++) {
    const sq = SEARCH_QUERIES[i];
    const label = sq.city
      ? `[${i + 1}/${SEARCH_QUERIES.length}] City: ${sq.city} — ${sq.query.substring(0, 60)}`
      : `[${i + 1}/${SEARCH_QUERIES.length}] ${sq.category}: ${sq.query.substring(0, 60)}`;
    console.log(label);

    try {
      // Insert discovery run record
      const [run] = await sql`
        INSERT INTO instagram_discovery_runs (
          tenant_id, search_query, search_type, status, metadata
        ) VALUES (
          ${TENANT_ID},
          ${sq.query},
          ${'keyword'},
          ${'pending'},
          ${JSON.stringify({ category: sq.category, city: sq.city, vertical: 'credit_repair' })}::jsonb
        )
        RETURNING id
      `;

      totalRunsCreated++;

      // Queue the job
      await queue.add('instagram-discovery', {
        tenantId: TENANT_ID,
        searchQuery: sq.query,
        searchType: 'keyword',
        discoveryRunId: run.id,
      }, {
        jobId: `ig-discovery-${run.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });

      totalJobsQueued++;
      console.log(`  -> Discovery run #${run.id} created and queued.`);
    } catch (err) {
      console.error(`  !! Error processing query: ${err.message}`);
    }
  }

  console.log('\n=== Instagram Discovery Summary ===');
  console.log(`Total discovery runs created: ${totalRunsCreated}`);
  console.log(`Total jobs queued:            ${totalJobsQueued}`);
  console.log(`Queue name:                   instagram_discovery_queue`);
  console.log('\nJobs are now waiting for the instagram-discovery worker to process them.');

  await queue.close();
  await redisConn.quit();
  await sql.end();
}

main().catch(err => {
  console.error('Instagram discovery trigger failed:', err);
  process.exit(1);
});
