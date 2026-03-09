/**
 * test-free-sources.cjs
 *
 * Tests the FREE scraping-based source adapters (no API keys needed):
 *  1. Fetches Reddit RSS feed from r/CRedit (best free source)
 *  2. Extracts leads from RSS entries
 *  3. Inserts found leads into Railway Postgres
 *  4. Queues them for AI analysis via BullMQ
 *
 * Usage: node scripts/test-free-sources.cjs
 */

const postgres = require('/Users/thebooth/ai-lead-hunter/packages/db/node_modules/postgres');
const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────────────────────────
const DB_URL = 'postgresql://postgres:GLGUwEndhZBYWITgOdRvPNjktGrlsDHh@metro.proxy.rlwy.net:19515/railway';
const REDIS_URL = 'redis://default:OTmPxBXVUQMwnAKCGCHJjqFujRmjHXYp@trolley.proxy.rlwy.net:25744';
const TENANT_ID = 1;
const QUEUE_NAME = 'lead_analysis_queue';

const sql = postgres(DB_URL);

const { Queue } = require('/Users/thebooth/ai-lead-hunter/node_modules/.pnpm/bullmq@5.70.4/node_modules/bullmq');
const IORedis = require('/Users/thebooth/ai-lead-hunter/node_modules/.pnpm/ioredis@5.10.0/node_modules/ioredis');

// ── RSS Parser (inline, matching the adapter logic) ─────────────────────────

function extractTag(xml, tag) {
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(regex);
  return m ? m[1].trim() : '';
}

function extractAttr(xml, tag, attr) {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i');
  const m = xml.match(regex);
  return m ? m[1] : '';
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRss(xml) {
  const items = [];

  // Try Atom format first (Reddit uses Atom)
  const atomEntryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = atomEntryRegex.exec(xml)) !== null) {
    const block = match[1];
    const authorBlock = block.match(/<author>([\s\S]*?)<\/author>/i);
    let author = null;
    if (authorBlock) {
      const name = extractTag(authorBlock[1], 'name');
      if (name) {
        const redditUser = name.match(/\/u\/([A-Za-z0-9_-]+)/);
        author = redditUser ? redditUser[1] : name;
      }
    }

    const title = stripHtml(extractTag(block, 'title') || '');
    const content = stripHtml(extractTag(block, 'content') || extractTag(block, 'summary') || '');
    const link = extractAttr(block, 'link', 'href');
    const pubDate = extractTag(block, 'published') || extractTag(block, 'updated');
    const category = extractAttr(block, 'category', 'term');

    items.push({ title, description: content, author, link, pubDate, category });
  }

  // If no Atom entries, try RSS 2.0
  if (items.length === 0) {
    const rssItemRegex = /<item>([\s\S]*?)<\/item>/gi;
    while ((match = rssItemRegex.exec(xml)) !== null) {
      const block = match[1];
      const author = extractTag(block, 'dc:creator') || extractTag(block, 'author') || null;
      items.push({
        title: extractTag(block, 'title'),
        description: stripHtml(extractTag(block, 'description') || extractTag(block, 'content:encoded') || ''),
        author,
        link: extractTag(block, 'link') || extractAttr(block, 'link', 'href'),
        pubDate: extractTag(block, 'pubDate') || extractTag(block, 'dc:date'),
        category: extractTag(block, 'category'),
      });
    }
  }

  return items;
}

// ── Credit-repair relevance keywords ────────────────────────────────────────
const CREDIT_KEYWORDS = [
  'credit score', 'credit repair', 'credit report', 'collection',
  'debt', 'dispute', 'charge off', 'late payment', 'fico',
  'hard inquiry', 'credit card', 'credit bureau', 'equifax',
  'experian', 'transunion', 'mortgage', 'home loan', 'pre-approved',
  'denied', 'bad credit', 'rebuild credit', 'improve credit',
  'credit utilization', 'student loan', 'medical debt',
];

function isRelevant(text) {
  const lower = text.toLowerCase();
  return CREDIT_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== LeadPulseLab FREE Source Test ===\n');
  console.log('Testing Reddit RSS (no API key needed)\n');

  const subreddits = ['CRedit', 'personalfinance', 'Debt', 'povertyfinance', 'FirstTimeHomeBuyer'];
  const allItems = [];

  // Step 1: Fetch RSS feeds
  console.log('Step 1: Fetching RSS feeds from', subreddits.length, 'subreddits...');
  for (const sub of subreddits) {
    const feedUrl = `https://www.reddit.com/r/${sub}/new/.rss`;
    try {
      const res = await fetch(feedUrl, {
        headers: {
          'User-Agent': 'LeadPulseLab/1.0 (RSS Reader)',
          'Accept': 'application/atom+xml, application/rss+xml, application/xml',
        },
      });

      if (!res.ok) {
        console.log(`  r/${sub}: HTTP ${res.status} (skipped)`);
        continue;
      }

      const xml = await res.text();
      const items = parseRss(xml);
      console.log(`  r/${sub}: ${items.length} entries fetched`);

      for (const item of items) {
        item._subreddit = sub;
        allItems.push(item);
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.log(`  r/${sub}: ERROR - ${err.message}`);
    }
  }

  console.log(`\nTotal entries fetched: ${allItems.length}`);

  // Step 2: Filter for credit-repair relevance
  console.log('\nStep 2: Filtering for credit-repair relevant posts...');
  const relevant = allItems.filter(item => {
    const text = `${item.title} ${item.description}`;
    return isRelevant(text);
  });
  console.log(`  Relevant posts: ${relevant.length} / ${allItems.length}`);

  if (relevant.length === 0) {
    console.log('\n  No relevant posts found. All posts will be shown for review:\n');
    for (const item of allItems.slice(0, 5)) {
      console.log(`  [r/${item._subreddit}] ${item.title.substring(0, 80)}`);
      console.log(`    by: ${item.author || 'unknown'} | ${item.pubDate || 'no date'}`);
    }
    console.log('\n  Inserting ALL posts as leads (AI analysis will score them)...');
    // Use all items if none match keywords - let AI decide
    relevant.push(...allItems);
  }

  // Step 3: Ensure platform_source exists
  console.log('\nStep 3: Ensuring platform_source for rss_feed adapter...');
  let [source] = await sql`
    SELECT id FROM platform_sources
    WHERE tenant_id = ${TENANT_ID} AND adapter_key = 'rss_feed'
    LIMIT 1
  `;
  if (!source) {
    [source] = await sql`
      INSERT INTO platform_sources (tenant_id, name, source_type, adapter_key, is_enabled, config_json)
      VALUES (${TENANT_ID}, 'Reddit RSS (Free)', 'social', 'rss_feed', true, '{"subreddits":["CRedit","personalfinance","Debt","povertyfinance","FirstTimeHomeBuyer"]}')
      RETURNING id
    `;
    console.log('  Created platform_source id:', source.id);
  } else {
    console.log('  Using existing platform_source id:', source.id);
  }

  // Step 4: Create scan_job
  console.log('\nStep 4: Creating scan_job...');
  const [scanJob] = await sql`
    INSERT INTO scan_jobs (tenant_id, source_id, status, started_at)
    VALUES (${TENANT_ID}, ${source.id}, 'completed', now())
    RETURNING id
  `;
  console.log('  scan_job id:', scanJob.id);

  // Step 5: Insert raw_source
  console.log('\nStep 5: Inserting raw_source...');
  const sourcePayload = { subreddits, itemCount: relevant.length, fetchedAt: new Date().toISOString() };
  const sourceHash = crypto.createHash('sha256').update(JSON.stringify(sourcePayload)).digest('hex');
  const [rawSource] = await sql`
    INSERT INTO raw_sources (tenant_id, scan_job_id, source_name, source_type, source_url, fetch_method, source_payload_json, checksum_hash)
    VALUES (${TENANT_ID}, ${scanJob.id}, 'reddit_rss', 'social', 'https://www.reddit.com/r/CRedit/new/.rss', 'rss', ${JSON.stringify(sourcePayload)}, ${sourceHash})
    RETURNING id
  `;
  console.log('  raw_source id:', rawSource.id);

  // Step 6: Insert raw_leads and queue for analysis
  console.log('\nStep 6: Inserting raw_leads and queuing for AI analysis...');

  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection: redis });

  let inserted = 0;
  let dupes = 0;
  const limit = Math.min(relevant.length, 50); // Cap at 50 to be reasonable

  for (let i = 0; i < limit; i++) {
    const item = relevant[i];
    const rawText = `${item.title}\n${item.description}`;
    const textHash = crypto.createHash('sha256').update(rawText).digest('hex');

    // Check for duplicate
    const [existing] = await sql`
      SELECT id FROM raw_leads WHERE text_hash = ${textHash} AND tenant_id = ${TENANT_ID} LIMIT 1
    `;
    if (existing) {
      dupes++;
      continue;
    }

    const [lead] = await sql`
      INSERT INTO raw_leads (
        tenant_id, raw_source_id, platform, profile_name, profile_url,
        source_url, matched_keywords, raw_text, raw_metadata_json,
        location_text, contact_hint, content_date, text_hash, processing_status
      ) VALUES (
        ${TENANT_ID}, ${rawSource.id}, 'reddit', ${item.author || null},
        ${item.author ? `https://www.reddit.com/user/${item.author}` : null},
        ${item.link || ''}, ${JSON.stringify(CREDIT_KEYWORDS.filter(kw => rawText.toLowerCase().includes(kw)))},
        ${rawText}, ${JSON.stringify({ subreddit: item._subreddit, pubDate: item.pubDate, category: item.category })},
        null, null, ${item.pubDate ? new Date(item.pubDate) : null},
        ${textHash}, 'pending'
      ) RETURNING id
    `;

    // Queue for AI analysis
    await queue.add('analyze-lead', {
      rawLeadId: lead.id,
      tenantId: TENANT_ID,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    inserted++;
  }

  console.log(`  Inserted: ${inserted} new leads`);
  console.log(`  Duplicates skipped: ${dupes}`);
  console.log(`  Queued for AI analysis: ${inserted}`);

  // Step 7: Show sample of what we found
  console.log('\n=== Sample Leads Found ===\n');
  const samples = relevant.slice(0, 5);
  for (const item of samples) {
    console.log(`[r/${item._subreddit}] ${item.title.substring(0, 100)}`);
    console.log(`  Author: ${item.author || 'unknown'}`);
    console.log(`  Date: ${item.pubDate || 'unknown'}`);
    console.log(`  Link: ${item.link || 'none'}`);
    const preview = item.description.substring(0, 150).replace(/\n/g, ' ');
    console.log(`  Preview: ${preview}...`);
    console.log('');
  }

  // Step 8: Summary
  const [leadCount] = await sql`SELECT count(*) as cnt FROM raw_leads WHERE tenant_id = ${TENANT_ID}`;
  const [pendingCount] = await sql`SELECT count(*) as cnt FROM raw_leads WHERE tenant_id = ${TENANT_ID} AND processing_status = 'pending'`;

  console.log('=== Summary ===');
  console.log(`Total raw_leads in DB: ${leadCount.cnt}`);
  console.log(`Pending analysis: ${pendingCount.cnt}`);
  console.log(`\nFree sources working! No API keys used.`);

  // Cleanup
  await queue.close();
  await redis.quit();
  await sql.end();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
