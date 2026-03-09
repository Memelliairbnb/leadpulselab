/**
 * test-pipeline.cjs
 *
 * End-to-end pipeline test:
 *  1. Creates prerequisite records (platform_source, scan_job, raw_source)
 *  2. Inserts a fake raw_lead simulating a credit-problems post
 *  3. Pushes an "analyze-lead" job to the BullMQ lead_analysis_queue
 *  4. Polls for 60s to see if the ai-analysis-worker picks it up
 *
 * Usage: node scripts/test-pipeline.cjs
 */

const postgres = require('/Users/thebooth/ai-lead-hunter/packages/db/node_modules/postgres');
const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────────────────────────
const DB_URL = 'postgresql://postgres:GLGUwEndhZBYWITgOdRvPNjktGrlsDHh@metro.proxy.rlwy.net:19515/railway';
const REDIS_URL = 'redis://default:OTmPxBXVUQMwnAKCGCHJjqFujRmjHXYp@trolley.proxy.rlwy.net:25744';
const TENANT_ID = 1;
const QUEUE_NAME = 'lead_analysis_queue';

const sql = postgres(DB_URL);

// BullMQ uses ioredis under the hood. We'll use the copy from pnpm store.
const { Queue } = require('/Users/thebooth/ai-lead-hunter/node_modules/.pnpm/bullmq@5.70.4/node_modules/bullmq');
const IORedis = require('/Users/thebooth/ai-lead-hunter/node_modules/.pnpm/ioredis@5.10.0/node_modules/ioredis');

async function main() {
  console.log('=== LeadPulseLab Pipeline Test ===\n');

  // ── Step 0: verify tenant prerequisites ──────────────────────────────
  console.log('Step 0: Checking tenant prerequisites...');
  const [aiCfg] = await sql`SELECT id FROM tenant_ai_config WHERE tenant_id = ${TENANT_ID} LIMIT 1`;
  if (!aiCfg) {
    console.error('ERROR: No tenant_ai_config for tenant', TENANT_ID);
    process.exit(1);
  }
  console.log('  tenant_ai_config: OK (id=' + aiCfg.id + ')');

  const [scoringModel] = await sql`SELECT id FROM tenant_scoring_models WHERE tenant_id = ${TENANT_ID} AND is_active = true LIMIT 1`;
  console.log('  scoring model:', scoringModel ? 'OK (id=' + scoringModel.id + ')' : 'MISSING');

  const leadTypes = await sql`SELECT name FROM tenant_lead_types WHERE tenant_id = ${TENANT_ID}`;
  console.log('  lead types:', leadTypes.map(t => t.name).join(', '));

  // ── Step 1: Create platform_source (if not exists) ───────────────────
  console.log('\nStep 1: Ensuring platform_source exists...');
  let [source] = await sql`
    SELECT id FROM platform_sources
    WHERE tenant_id = ${TENANT_ID} AND adapter_key = 'test_manual'
    LIMIT 1
  `;
  if (!source) {
    [source] = await sql`
      INSERT INTO platform_sources (tenant_id, name, source_type, adapter_key, is_enabled, config_json)
      VALUES (${TENANT_ID}, 'Test Manual Source', 'manual', 'test_manual', true, '{}')
      RETURNING id
    `;
    console.log('  Created platform_source id:', source.id);
  } else {
    console.log('  Existing platform_source id:', source.id);
  }

  // ── Step 2: Create scan_job ──────────────────────────────────────────
  console.log('\nStep 2: Creating scan_job...');
  const [scanJob] = await sql`
    INSERT INTO scan_jobs (tenant_id, source_id, status, trigger_type, keywords_used)
    VALUES (${TENANT_ID}, ${source.id}, 'completed', 'manual', '["credit repair", "bad credit", "fix my credit"]')
    RETURNING id
  `;
  console.log('  scan_job id:', scanJob.id);

  // ── Step 3: Create raw_source ────────────────────────────────────────
  console.log('\nStep 3: Creating raw_source...');
  const payload = {
    type: 'test',
    content: 'Reddit post about credit problems',
    timestamp: new Date().toISOString(),
  };
  const payloadStr = JSON.stringify(payload);
  const checksumHash = crypto.createHash('sha256').update(payloadStr).digest('hex');

  const [rawSource] = await sql`
    INSERT INTO raw_sources (tenant_id, scan_job_id, source_name, source_type, source_url, fetch_method, source_payload_json, checksum_hash)
    VALUES (
      ${TENANT_ID},
      ${scanJob.id},
      'Test Manual Source',
      'manual',
      'https://reddit.com/r/CreditRepair/test-post-pipeline',
      'manual_insert',
      ${sql.json(payload)},
      ${checksumHash}
    )
    RETURNING id
  `;
  console.log('  raw_source id:', rawSource.id);

  // ── Step 4: Create raw_lead ──────────────────────────────────────────
  console.log('\nStep 4: Inserting fake raw_lead...');
  const rawText = `I'm really struggling with my credit score. It dropped to 520 after some medical bills went to collections. I've been trying to dispute items on my own but the bureaus keep saying the debts are verified. I need professional help to get these removed. Has anyone worked with a credit repair company that actually got results? I'm in Houston, TX and I'm desperate to fix this before I try to buy a house next year. My wife and I have been saving for a down payment but we can't get pre-approved with scores this low. Any recommendations would be appreciated.`;

  const textHash = crypto.createHash('sha256').update(rawText).digest('hex');

  const [rawLead] = await sql`
    INSERT INTO raw_leads (
      tenant_id, raw_source_id, platform, profile_name, profile_url,
      source_url, matched_keywords, raw_text, raw_metadata_json,
      location_text, contact_hint, content_date, text_hash, processing_status
    )
    VALUES (
      ${TENANT_ID},
      ${rawSource.id},
      'reddit',
      'CreditStruggler2026',
      'https://reddit.com/u/CreditStruggler2026',
      'https://reddit.com/r/CreditRepair/test-post-pipeline',
      '["credit repair", "bad credit", "fix my credit"]',
      ${rawText},
      ${sql.json({ subreddit: 'CreditRepair', upvotes: 15, comment_count: 8, post_type: 'text' })},
      'Houston, TX',
      'reddit_dm',
      ${new Date()},
      ${textHash},
      'pending'
    )
    RETURNING id
  `;
  console.log('  raw_lead id:', rawLead.id);

  // ── Step 5: Push job to BullMQ lead_analysis_queue ───────────────────
  console.log('\nStep 5: Pushing job to', QUEUE_NAME, '...');

  const redisConn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  const queue = new Queue(QUEUE_NAME, {
    connection: redisConn,
  });

  const job = await queue.add(
    'analyze-lead',
    {
      rawLeadId: rawLead.id,
      tenantId: TENANT_ID,
    },
    {
      jobId: `test-analyze-${rawLead.id}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    }
  );
  console.log('  BullMQ job id:', job.id);
  console.log('  Queue:', QUEUE_NAME);

  // ── Step 6: Poll for result ──────────────────────────────────────────
  console.log('\nStep 6: Polling for processing result (up to 90s)...');
  const startTime = Date.now();
  const TIMEOUT = 90_000;
  const POLL_INTERVAL = 5_000;

  while (Date.now() - startTime < TIMEOUT) {
    const [lead] = await sql`
      SELECT processing_status FROM raw_leads WHERE id = ${rawLead.id}
    `;

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  [${elapsed}s] processing_status: ${lead.processing_status}`);

    if (lead.processing_status === 'analyzed') {
      console.log('\n=== SUCCESS: Lead was analyzed! ===');
      const [ql] = await sql`
        SELECT id, lead_type, intent_level, lead_score, ai_summary, ai_recommended_action, status
        FROM qualified_leads
        WHERE raw_lead_id = ${rawLead.id}
        LIMIT 1
      `;
      if (ql) {
        console.log('\nQualified Lead Result:');
        console.log('  ID:', ql.id);
        console.log('  Lead Type:', ql.lead_type);
        console.log('  Intent Level:', ql.intent_level);
        console.log('  Lead Score:', ql.lead_score);
        console.log('  Status:', ql.status);
        console.log('  AI Summary:', ql.ai_summary);
        console.log('  Recommended Action:', ql.ai_recommended_action);
      }
      await cleanup(queue, redisConn);
      return;
    }

    if (lead.processing_status === 'failed') {
      console.log('\n=== FAILED: Lead analysis failed ===');
      console.log('  The ai-analysis-worker picked up the job but it errored.');
      console.log('  Check Railway logs: railway logs --service ai-analysis-worker');
      await cleanup(queue, redisConn);
      return;
    }

    await sleep(POLL_INTERVAL);
  }

  console.log('\n=== TIMEOUT: Lead was not processed within 90s ===');
  console.log('Possible causes:');
  console.log('  1. ai-analysis-worker is not running (check Railway dashboard)');
  console.log('  2. Worker crashed on startup (check: railway logs --service ai-analysis-worker)');
  console.log('  3. Redis connection issue between worker and queue');
  console.log('\nThe raw_lead (id=' + rawLead.id + ') and BullMQ job are still in place.');
  console.log('If you fix the worker, it should pick up the job automatically.');

  // Check queue state
  const waiting = await queue.getWaitingCount();
  const active = await queue.getActiveCount();
  const failed = await queue.getFailedCount();
  console.log('\nQueue state for', QUEUE_NAME + ':');
  console.log('  Waiting:', waiting);
  console.log('  Active:', active);
  console.log('  Failed:', failed);

  await cleanup(queue, redisConn);
}

async function cleanup(queue, redisConn) {
  await queue.close();
  await redisConn.quit();
  await sql.end();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(async (err) => {
  console.error('FATAL ERROR:', err);
  await sql.end().catch(() => {});
  process.exit(1);
});
