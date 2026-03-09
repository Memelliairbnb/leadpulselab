/**
 * Intent-based discovery scan — searches for REAL people expressing credit repair needs
 * on forums, Q&A sites, and review sites using buying signal phrases.
 */
const postgres = require('/Users/thebooth/ai-lead-hunter/packages/db/node_modules/postgres');
const { Queue } = require('/Users/thebooth/ai-lead-hunter/node_modules/.pnpm/bullmq@5.70.4/node_modules/bullmq');
const IORedis = require('/Users/thebooth/ai-lead-hunter/node_modules/.pnpm/ioredis@5.10.0/node_modules/ioredis');
const crypto = require('crypto');

const DB_URL = 'postgresql://postgres:GLGUwEndhZBYWITgOdRvPNjktGrlsDHh@metro.proxy.rlwy.net:19515/railway';
const REDIS_URL = 'redis://default:OTmPxBXVUQMwnAKCGCHJjqFujRmjHXYp@trolley.proxy.rlwy.net:25744';
const GOOGLE_API_KEY = 'AIzaSyBC6atOmRZTrl2grY553U5_KqLdcsP30f8';
const GOOGLE_CX = '92144ffc5f02045df';
const TENANT_ID = 1;

const sql = postgres(DB_URL);

// Intent signal queries — real people expressing real needs
const INTENT_QUERIES = [
  { query: '("need help with" OR "how do I fix") "credit score" site:reddit.com', category: 'Credit Pain', site: 'reddit.com' },
  { query: '("anyone recommend" OR "looking for") "credit repair" site:reddit.com', category: 'Credit Pain', site: 'reddit.com' },
  { query: '("how do I fix" OR "how can I improve") "credit score" site:quora.com', category: 'Credit Pain', site: 'quora.com' },
  { query: '("need help" OR "looking for") "credit repair" site:quora.com', category: 'Credit Pain', site: 'quora.com' },
  { query: '("denied for" OR "rejected for") ("mortgage" OR "loan") "bad credit"', category: 'Loan Denial', site: null },
  { query: '("turned down" OR "can\'t qualify") "mortgage" "credit score" site:reddit.com', category: 'Loan Denial', site: 'reddit.com' },
  { query: '("need business funding" OR "need business loan") "bad credit" site:reddit.com', category: 'Funding Need', site: 'reddit.com' },
  { query: '("looking for" OR "recommend") "credit repair" site:yelp.com', category: 'Referral Signals', site: 'yelp.com' },
  { query: '("need help with" OR "anyone know") "remove collections" "credit report"', category: 'Credit Pain', site: null },
  { query: '("how do I" OR "can someone help") "improve credit score" "collections"', category: 'Credit Pain', site: null },
];

function detectPlatform(url) {
  if (url.includes('reddit.com')) return 'reddit';
  if (url.includes('quora.com')) return 'quora';
  if (url.includes('yelp.com')) return 'yelp';
  if (url.includes('trustpilot.com')) return 'trustpilot';
  if (url.includes('bbb.org')) return 'bbb';
  return 'web';
}

function extractAuthor(url) {
  const redditMatch = url.match(/reddit\.com\/(?:user|u)\/([^/?]+)/);
  if (redditMatch) return redditMatch[1];
  const quoraMatch = url.match(/quora\.com\/profile\/([^/?]+)/);
  if (quoraMatch) return quoraMatch[1].replace(/-/g, ' ');
  return null;
}

function detectIntentSignals(text) {
  const signals = [];
  const phrases = [
    { phrase: 'need help with', type: 'seeking_help' },
    { phrase: 'looking for', type: 'seeking_help' },
    { phrase: 'how do i fix', type: 'expressing_pain' },
    { phrase: 'how do i improve', type: 'expressing_pain' },
    { phrase: 'anyone recommend', type: 'asking_recommendation' },
    { phrase: 'can someone recommend', type: 'asking_recommendation' },
    { phrase: 'anyone know', type: 'asking_recommendation' },
    { phrase: 'denied for', type: 'expressing_pain' },
    { phrase: 'rejected for', type: 'expressing_pain' },
    { phrase: 'turned down', type: 'expressing_pain' },
    { phrase: 'bad credit', type: 'expressing_pain' },
    { phrase: 'collections', type: 'expressing_pain' },
    { phrase: 'charge-off', type: 'expressing_pain' },
    { phrase: 'need business funding', type: 'requesting_service' },
  ];
  const lower = text.toLowerCase();
  for (const p of phrases) {
    if (lower.includes(p.phrase)) {
      signals.push({ phrase: p.phrase, intentType: p.type });
    }
  }
  return signals;
}

async function searchGoogle(query) {
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', GOOGLE_API_KEY);
  url.searchParams.set('cx', GOOGLE_CX);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');
  const res = await fetch(url.toString());
  if (!res.ok) {
    console.error(`  Google API error ${res.status} for: ${query.substring(0, 60)}...`);
    return [];
  }
  const data = await res.json();
  return data.items || [];
}

async function main() {
  console.log('=== Intent-Based Discovery Scan ===\n');

  const redisConn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue('lead_analysis_queue', { connection: redisConn });

  // Ensure platform source
  const [source] = await sql`
    INSERT INTO platform_sources (tenant_id, name, adapter_key, source_type, is_enabled, config_json)
    VALUES (${TENANT_ID}, 'Intent Discovery', 'google_search_intent', 'search_engine', true, '{}')
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  const sourceId = source?.id || (await sql`SELECT id FROM platform_sources WHERE adapter_key = 'google_search_intent' LIMIT 1`)[0].id;
  console.log('Platform source id:', sourceId);

  const [scanJob] = await sql`
    INSERT INTO scan_jobs (tenant_id, source_id, status, started_at)
    VALUES (${TENANT_ID}, ${sourceId}, 'running', NOW())
    RETURNING id
  `;

  const [rawSource] = await sql`
    INSERT INTO raw_sources (tenant_id, scan_job_id, source_name, source_type, source_url, fetch_method, source_payload_json, checksum_hash, fetched_at)
    VALUES (${TENANT_ID}, ${scanJob.id}, 'Intent Discovery', 'search_engine', 'intent-discovery-scan', 'api', '{}', ${crypto.createHash('sha256').update('intent-scan-' + Date.now()).digest('hex')}, NOW())
    RETURNING id
  `;

  let totalLeads = 0;
  let totalQueued = 0;
  const seenUrls = new Set();

  for (let i = 0; i < INTENT_QUERIES.length; i++) {
    const iq = INTENT_QUERIES[i];
    console.log(`\n[${i+1}/${INTENT_QUERIES.length}] ${iq.category}: ${iq.query.substring(0, 70)}...`);

    const results = await searchGoogle(iq.query);
    console.log(`  Found ${results.length} results`);

    for (const item of results) {
      if (seenUrls.has(item.link)) continue;
      seenUrls.add(item.link);

      const platform = detectPlatform(item.link);
      const author = extractAuthor(item.link);
      const rawText = `${item.title}\n${item.snippet}`;
      const signals = detectIntentSignals(rawText);
      const textHash = crypto.createHash('sha256').update(rawText).digest('hex');

      const [rawLead] = await sql`
        INSERT INTO raw_leads (
          tenant_id, raw_source_id, platform, profile_name, profile_url,
          source_url, matched_keywords, raw_text, raw_metadata_json,
          text_hash, processing_status
        ) VALUES (
          ${TENANT_ID}, ${rawSource.id}, ${platform}, ${author},
          ${author && platform === 'reddit' ? `https://reddit.com/user/${author}` : null},
          ${item.link},
          ${JSON.stringify(signals.map(s => s.phrase))}::jsonb,
          ${rawText},
          ${JSON.stringify({ title: item.title, snippet: item.snippet, intentCategory: iq.category, targetSite: iq.site, intentSignals: signals })}::jsonb,
          ${textHash}, 'pending'
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `;

      if (!rawLead) continue;
      totalLeads++;

      // Insert signal records
      for (const sig of signals) {
        await sql`
          INSERT INTO lead_signals (
            tenant_id, raw_lead_id, signal_phrase, intent_type,
            signal_strength, source_url, source_platform, author_name, content_snippet
          ) VALUES (
            ${TENANT_ID}, ${rawLead.id}, ${sig.phrase}, ${sig.intentType},
            ${Math.min(100, 40 + signals.length * 15)}, ${item.link}, ${platform},
            ${author}, ${item.snippet.substring(0, 500)}
          )
        `;
      }

      // Queue for AI analysis via BullMQ
      await queue.add('analyze-lead', { rawLeadId: rawLead.id, tenantId: TENANT_ID }, {
        jobId: `intent-${rawLead.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
      });
      totalQueued++;
      console.log(`  + Lead #${rawLead.id} [${platform}] ${author || 'unknown'} — ${signals.length} signals`);
    }

    // Rate limit delay between queries
    if (i < INTENT_QUERIES.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  // Update scan job
  await sql`UPDATE scan_jobs SET status = 'completed', completed_at = NOW(), leads_found = ${totalLeads} WHERE id = ${scanJob.id}`;

  console.log(`\n=== Discovery Complete ===`);
  console.log(`Total unique leads: ${totalLeads}`);
  console.log(`Queued for AI analysis: ${totalQueued}`);
  console.log(`\nThe ai-analysis-worker is now processing these with intent-aware prompts.`);

  // Wait and show results
  console.log('\nWaiting 60s for AI analysis to complete...');
  await new Promise(r => setTimeout(r, 60000));

  const results = await sql`
    SELECT id, lead_type, intent_level, lead_score, full_name, is_real_person, intent_type, estimated_urgency,
           substring(ai_summary from 1 for 120) as summary_preview
    FROM qualified_leads
    ORDER BY id DESC LIMIT 20
  `;
  console.log('\n=== Analyzed Leads ===');
  console.table(results);

  await queue.close();
  await redisConn.quit();
  await sql.end();
}

main().catch(err => {
  console.error('Discovery failed:', err);
  process.exit(1);
});
