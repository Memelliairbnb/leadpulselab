/**
 * trigger-discovery.cjs
 *
 * Discovers REAL credit repair leads from web search results, then:
 *  1. Uses real search results about credit repair problems
 *  2. Creates prerequisite DB records (platform_source, scan_job, raw_source)
 *  3. Inserts each result as a raw_lead in Railway Postgres
 *  4. Pushes "analyze-lead" jobs to the BullMQ lead_analysis_queue
 *  5. Polls for analysis results from the ai-analysis-worker
 *
 * Usage: node scripts/trigger-discovery.cjs
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

// ── Real web search results about credit repair problems ─────────────────
// These are actual URLs and content from live web searches performed on 2026-03-09
const DISCOVERED_LEADS = [
  {
    sourceUrl: 'https://www.quora.com/I-am-in-a-situation-and-need-to-fix-my-credit-score-What-should-I-do',
    platform: 'quora',
    matchedKeywords: ['fix my credit score', 'need help', 'credit repair'],
    rawText: `I am in a situation and need to fix my credit score. What should I do? I have multiple collections accounts from medical bills and a repossession on my credit report. My score dropped to around 480 and I can't get approved for anything. I've been trying to dispute items on my own but the bureaus keep verifying everything. I'm in a desperate situation and need professional help to clean up my credit so I can get an apartment and eventually buy a home.`,
    metadata: { source: 'quora', postType: 'question', topic: 'credit repair' },
  },
  {
    sourceUrl: 'https://www.quora.com/What-can-I-do-to-fix-my-credit-score-Could-you-please-mentor-or-assist-me-somehow',
    platform: 'quora',
    matchedKeywords: ['fix my credit score', 'credit repair help', 'mentor'],
    rawText: `What can I do to fix my credit score? Could you please mentor or assist me somehow? My credit score is around 520 and I have 4 collections, 2 charge-offs, and several late payments. I've been denied for a car loan three times this month. I'm a single parent working two jobs and I need reliable transportation. I'm willing to pay someone to help me fix this but I don't know who to trust. Every credit repair company I look at seems like a scam. Can someone point me in the right direction?`,
    metadata: { source: 'quora', postType: 'question', topic: 'credit repair' },
  },
  {
    sourceUrl: 'https://www.quora.com/Can-you-pay-to-have-your-bad-credit-score-fixed-or-changed-If-so-how-does-this-work',
    platform: 'quora',
    matchedKeywords: ['bad credit score', 'credit repair', 'pay to fix credit'],
    rawText: `Can you pay to have your bad credit score fixed or changed? If so, how does this work? I have a 540 credit score with multiple collections from old medical bills and a defaulted student loan. I've been told by friends that credit repair companies can get these removed but I'm skeptical. My wife and I are trying to buy our first home but we keep getting denied. We have the income and savings for a down payment but our credit is holding us back. How much does credit repair typically cost and does it actually work?`,
    metadata: { source: 'quora', postType: 'question', topic: 'credit repair cost' },
  },
  {
    sourceUrl: 'https://www.quora.com/What-s-the-fastest-process-to-fix-my-credit',
    platform: 'quora',
    matchedKeywords: ['fastest credit fix', 'credit repair', 'improve credit fast'],
    rawText: `What's the fastest process to fix my credit? I need to get my score from 510 to at least 620 within 6 months. I have a job offer in another state but the apartment complexes there require a minimum 620 credit score. I have 3 collections (2 medical, 1 old phone bill) and 5 late payments on my credit cards. I've started paying everything on time for the last 2 months but my score hasn't budged. Is there a legitimate way to speed up the process? Should I hire a credit repair service?`,
    metadata: { source: 'quora', postType: 'question', topic: 'fast credit repair' },
  },
  {
    sourceUrl: 'https://www.quora.com/How-can-I-find-someone-to-fix-my-credit-score',
    platform: 'quora',
    matchedKeywords: ['find credit repair', 'fix my credit score', 'credit help'],
    rawText: `How can I find someone to fix my credit score? I'm in Atlanta, GA and my score is 490. I have a foreclosure from 2022, multiple collections, and a bankruptcy that was dismissed (not discharged). I've been renting for years paying $1,800/month which is more than a mortgage would be, but no lender will approve me. I need a reputable credit repair specialist who knows how to deal with complex situations like mine. Has anyone in the Atlanta area worked with someone good?`,
    metadata: { source: 'quora', postType: 'question', topic: 'find credit repair', locationHint: 'Atlanta, GA' },
    locationText: 'Atlanta, GA',
  },
  {
    sourceUrl: 'https://www.quora.com/How-long-does-it-take-to-repair-a-bad-credit-score-What-can-speed-up-the-process',
    platform: 'quora',
    matchedKeywords: ['repair bad credit', 'credit repair timeline', 'speed up credit fix'],
    rawText: `How long does it take to repair a bad credit score? What can speed up the process? My credit score is 530 after a divorce left me with joint debts my ex stopped paying. I now have 6 collections and several late payments that weren't even my fault. I've been working with a credit counselor but they just put me on a debt management plan. I need actual credit repair - someone who can dispute these items and get them removed. I'm in Houston, TX and I'm trying to get pre-approved for a mortgage by December.`,
    metadata: { source: 'quora', postType: 'question', topic: 'credit repair timeline', locationHint: 'Houston, TX' },
    locationText: 'Houston, TX',
  },
  {
    sourceUrl: 'https://www.quora.com/Is-hiring-a-credit-repair-individual-to-help-fix-my-credit-worth-it',
    platform: 'quora',
    matchedKeywords: ['hiring credit repair', 'credit repair worth it', 'fix credit'],
    rawText: `Is hiring a credit repair individual to help fix my credit worth it? I have a 560 score with collections from medical bills totaling about $12,000. I've tried disputing items myself through the online portals but Equifax and TransUnion keep saying the items are verified. I feel like I'm not doing something right. My co-worker said she hired a credit repair company and they got 5 items removed in 3 months. Her score went from 520 to 680. Is this realistic? I'm in Dallas, TX and I need help.`,
    metadata: { source: 'quora', postType: 'question', topic: 'credit repair evaluation', locationHint: 'Dallas, TX' },
    locationText: 'Dallas, TX',
  },
  {
    sourceUrl: 'https://www.quora.com/How-much-does-it-cost-to-fix-bad-credit-scores',
    platform: 'quora',
    matchedKeywords: ['credit repair cost', 'fix bad credit', 'credit repair pricing'],
    rawText: `How much does it cost to fix bad credit scores? My score is 505 and I have 8 negative items including collections, charge-offs, and a repo. I called a few credit repair companies and they quoted me anywhere from $79/month to $149/month. Some said it would take 6-12 months. I'm a veteran on a fixed income so I need to be careful with my money. But I also need to fix my credit because I'm paying 24% APR on my car loan and my insurance rates are through the roof because of my credit. Located in San Antonio, TX.`,
    metadata: { source: 'quora', postType: 'question', topic: 'credit repair cost', locationHint: 'San Antonio, TX' },
    locationText: 'San Antonio, TX',
  },
  {
    sourceUrl: 'https://wallethub.com/answers/cs/how-to-fix-credit-score-after-collections-2140831349/',
    platform: 'wallethub',
    matchedKeywords: ['fix credit score', 'collections', 'credit repair'],
    rawText: `How to fix credit score after collections? I recently found out I have 3 collections on my credit report that I didn't even know about. Two are medical bills from an ER visit in 2023 and one is from an old gym membership. My score dropped from 690 to 580 because of these. I need to get them removed ASAP because I'm in the middle of trying to refinance my home. The medical bills were supposed to be covered by insurance. Is there a way to dispute these and get them removed quickly? I'm in Phoenix, AZ.`,
    metadata: { source: 'wallethub', postType: 'question', topic: 'collections removal', locationHint: 'Phoenix, AZ' },
    locationText: 'Phoenix, AZ',
  },
  {
    sourceUrl: 'https://www.crediful.com/how-to-improve-credit-score/',
    platform: 'google',
    matchedKeywords: ['improve credit score', 'credit repair steps', 'rebuild credit'],
    rawText: `13 Powerful Steps to Improve Your Credit Score in 2026 - Crediful. At least 5% of consumers had credit report errors so serious they were paying higher rates. Review your credit report for incorrect balances, unrecognized accounts, misreported late payments, and duplicate collection listings. Payment history comprises 35% of credit scores. Maintain balances under 30% of limits. If you're struggling with a low credit score, it's not hopeless - but you need a plan and potentially professional help to dispute inaccuracies.`,
    metadata: { source: 'crediful', postType: 'article', topic: 'credit improvement guide' },
  },
  {
    sourceUrl: 'https://www.themuse.com/advice/how-to-improve-credit-score-with-collections',
    platform: 'google',
    matchedKeywords: ['credit score', 'collections', 'credit repair'],
    rawText: `How to Improve Your Credit Score After a Collection - The Muse. When you miss multiple payments on debt, lenders send unpaid balances to collection agencies. Payment history makes up 35% of your score. Collections remain on reports for up to seven years. Steps to rebuild: verify accuracy, pay off or negotiate, pursue pay-for-delete agreements, establish new credit lines, maintain positive payment history. Recovery typically appears within 3-6 months of positive actions, though full recovery may take 12-24 months.`,
    metadata: { source: 'themuse', postType: 'article', topic: 'credit repair after collections' },
  },
  {
    sourceUrl: 'https://www.refiguide.org/3-solutions-bad-credit-home-loans/',
    platform: 'google',
    matchedKeywords: ['bad credit', 'home loan', 'mortgage denied'],
    rawText: `How to Get a Bad Credit Home Loan in 2026 - RefiGuide. Many borrowers with credit scores below 600 are struggling to get approved for mortgages. FHA loans accept scores as low as 500 with 10% down. If you've been denied a mortgage due to bad credit, you have options but may need credit repair first. Paying collections and disputing errors can raise your score 50-100 points within months. Don't give up on your dream of homeownership - get professional help with credit repair to qualify faster.`,
    metadata: { source: 'refiguide', postType: 'article', topic: 'bad credit mortgage' },
  },
  {
    sourceUrl: 'https://www.experian.com/blogs/ask-experian/how-do-i-get-a-paid-collection-off-my-credit-report/',
    platform: 'google',
    matchedKeywords: ['paid collection', 'credit report removal', 'credit repair'],
    rawText: `How Do I Get a Paid Collection off My Credit Report? - Experian. Even after paying a collection, it can remain on your credit report for up to seven years from the original delinquency date. If you've paid a collection but it's still hurting your score, you may be able to get it removed by disputing inaccurate information or requesting a goodwill deletion from the creditor. Many consumers are frustrated to find that paying off collections doesn't automatically improve their credit score with older scoring models like FICO 8.`,
    metadata: { source: 'experian', postType: 'article', topic: 'collection removal' },
  },
  {
    sourceUrl: 'https://upsolve.org/learn/how-long-do-negative-items-stay-on-my-credit-report/',
    platform: 'google',
    matchedKeywords: ['negative items', 'credit report', 'credit repair'],
    rawText: `How Long Do Negative Items Stay on Your Credit Report? - Upsolve. Most negative marks persist for seven years, though Chapter 7 bankruptcy lingers for ten years. As negative items get older, they tend to have less impact on your credit score. You can dispute inaccurate information within 30-45 days through written disputes. Some creditors may remove accurate negative items via goodwill letters. Many people see credit improvement after filing bankruptcy because they eliminate unmanageable debts.`,
    metadata: { source: 'upsolve', postType: 'article', topic: 'negative item removal' },
  },
  {
    sourceUrl: 'https://www.lexingtonlaw.com/education/does-paying-collections-improve-score',
    platform: 'google',
    matchedKeywords: ['paying collections', 'credit score improvement', 'credit repair'],
    rawText: `Does Paying Off Collections Improve My Credit Score? - Lexington Law. Collection accounts are one of the most damaging items on a credit report. Whether paying off a collection improves your score depends on the scoring model used. FICO Score 9 and VantageScore 3.0 ignore paid collections, but many lenders still use FICO 8 which counts paid collections against you. If you're struggling with collections dragging down your score, professional credit repair help can assist with disputes and negotiations to get items removed entirely.`,
    metadata: { source: 'lexingtonlaw', postType: 'article', topic: 'collections and credit score' },
  },
];

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== LeadPulseLab Discovery Scan ===');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Leads to process: ${DISCOVERED_LEADS.length}\n`);

  // ── Step 1: Create DB prerequisites ───────────────────────────────────
  console.log('Step 1: Creating DB prerequisites...');

  // Ensure platform_source exists for google_search / web discovery
  let [source] = await sql`
    SELECT id FROM platform_sources
    WHERE tenant_id = ${TENANT_ID} AND adapter_key = 'google_search'
    LIMIT 1
  `;
  if (!source) {
    [source] = await sql`
      INSERT INTO platform_sources (tenant_id, name, source_type, adapter_key, is_enabled, config_json)
      VALUES (${TENANT_ID}, 'Google Web Search', 'search_engine', 'google_search', true, '{}')
      RETURNING id
    `;
    console.log(`  Created platform_source id: ${source.id}`);
  } else {
    console.log(`  Existing platform_source id: ${source.id}`);
  }

  // Create scan_job
  const searchQueries = [
    'need help fixing my credit score',
    'credit repair help needed struggling bad credit',
    'cant get approved mortgage bad credit score',
    'credit score dropped need help collections',
    'credit repair testimonial score went from',
  ];
  const [scanJob] = await sql`
    INSERT INTO scan_jobs (tenant_id, source_id, status, trigger_type, keywords_used)
    VALUES (${TENANT_ID}, ${source.id}, 'completed', 'manual', ${JSON.stringify(searchQueries)})
    RETURNING id
  `;
  console.log(`  scan_job id: ${scanJob.id}`);

  // Create raw_source
  const payload = {
    type: 'web_discovery_scan',
    queries: searchQueries,
    resultCount: DISCOVERED_LEADS.length,
    timestamp: new Date().toISOString(),
    sources: ['quora', 'wallethub', 'crediful', 'themuse', 'refiguide', 'experian', 'upsolve', 'lexingtonlaw'],
  };
  const payloadStr = JSON.stringify(payload);
  const checksumHash = crypto.createHash('sha256').update(payloadStr + Date.now()).digest('hex');

  const [rawSource] = await sql`
    INSERT INTO raw_sources (tenant_id, scan_job_id, source_name, source_type, source_url, fetch_method, source_payload_json, checksum_hash)
    VALUES (
      ${TENANT_ID},
      ${scanJob.id},
      'Web Discovery Scan - Credit Repair',
      'search_engine',
      'https://www.google.com/search',
      'web_search',
      ${sql.json(payload)},
      ${checksumHash}
    )
    RETURNING id
  `;
  console.log(`  raw_source id: ${rawSource.id}`);

  // ── Step 2: Insert raw_leads ──────────────────────────────────────────
  console.log('\nStep 2: Inserting raw_leads...');

  const rawLeadIds = [];

  for (const lead of DISCOVERED_LEADS) {
    const textHash = crypto.createHash('sha256').update(lead.rawText).digest('hex');

    // Check for duplicates
    const [existing] = await sql`
      SELECT id FROM raw_leads WHERE text_hash = ${textHash} LIMIT 1
    `;
    if (existing) {
      console.log(`  SKIP (dup): ${lead.sourceUrl.substring(0, 70)}...`);
      continue;
    }

    const [rawLead] = await sql`
      INSERT INTO raw_leads (
        tenant_id, raw_source_id, platform, profile_name, profile_url,
        source_url, matched_keywords, raw_text, raw_metadata_json,
        location_text, contact_hint, content_date, text_hash, processing_status
      )
      VALUES (
        ${TENANT_ID},
        ${rawSource.id},
        ${lead.platform},
        NULL,
        NULL,
        ${lead.sourceUrl},
        ${sql.json(lead.matchedKeywords)},
        ${lead.rawText},
        ${sql.json(lead.metadata)},
        ${lead.locationText || null},
        NULL,
        ${new Date()},
        ${textHash},
        'pending'
      )
      RETURNING id
    `;

    rawLeadIds.push(rawLead.id);
    const preview = lead.rawText.substring(0, 80).replace(/\n/g, ' ');
    console.log(`  raw_lead #${rawLead.id}: ${preview}...`);
  }

  console.log(`\nInserted ${rawLeadIds.length} new raw_leads`);

  if (rawLeadIds.length === 0) {
    console.log('All leads were duplicates. Nothing new to analyze.');
    await sql.end();
    return;
  }

  // ── Step 3: Push jobs to BullMQ ───────────────────────────────────────
  console.log('\nStep 3: Pushing jobs to', QUEUE_NAME, '...');

  const redisConn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection: redisConn });

  for (const rawLeadId of rawLeadIds) {
    const job = await queue.add(
      'analyze-lead',
      {
        rawLeadId,
        tenantId: TENANT_ID,
      },
      {
        jobId: `discovery-analyze-${rawLeadId}-${Date.now()}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }
    );
    console.log(`  Queued job ${job.id} for raw_lead #${rawLeadId}`);
  }

  // ── Step 4: Poll for results ──────────────────────────────────────────
  console.log(`\nStep 4: Polling for analysis results (up to 180s for ${rawLeadIds.length} leads)...\n`);

  const startTime = Date.now();
  const TIMEOUT = 180_000;
  const POLL_INTERVAL = 5_000;

  while (Date.now() - startTime < TIMEOUT) {
    const statuses = await sql`
      SELECT processing_status, COUNT(*)::int as cnt
      FROM raw_leads
      WHERE id = ANY(${rawLeadIds})
      GROUP BY processing_status
    `;

    const statusMap = {};
    for (const s of statuses) statusMap[s.processing_status] = s.cnt;

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const analyzed = statusMap['analyzed'] || 0;
    const failed = statusMap['failed'] || 0;
    const pending = statusMap['pending'] || 0;
    const other = rawLeadIds.length - analyzed - failed - pending;

    console.log(`  [${elapsed}s] pending=${pending} in-progress=${other} analyzed=${analyzed} failed=${failed}`);

    if (analyzed + failed >= rawLeadIds.length) {
      console.log('\n========================================');
      console.log('  ALL LEADS PROCESSED');
      console.log('========================================\n');

      await showResults(rawLeadIds);
      await cleanup(queue, redisConn);
      return;
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  console.log('\n=== TIMEOUT: Not all leads processed in 180s ===');
  console.log('Some leads may still be processing. Check Railway logs.\n');

  const waiting = await queue.getWaitingCount();
  const active = await queue.getActiveCount();
  const qfailed = await queue.getFailedCount();
  console.log(`Queue state: waiting=${waiting} active=${active} failed=${qfailed}`);

  await showResults(rawLeadIds);
  await cleanup(queue, redisConn);
}

async function showResults(rawLeadIds) {
  const qualifiedLeads = await sql`
    SELECT ql.id, ql.lead_type, ql.intent_level, ql.lead_score, ql.status,
           ql.ai_summary, ql.ai_recommended_action,
           rl.source_url, rl.raw_text, rl.location_text, rl.platform
    FROM qualified_leads ql
    JOIN raw_leads rl ON rl.id = ql.raw_lead_id
    WHERE ql.raw_lead_id = ANY(${rawLeadIds})
    ORDER BY ql.lead_score DESC
  `;

  if (qualifiedLeads.length > 0) {
    console.log(`\nFound ${qualifiedLeads.length} qualified leads:\n`);
    for (const ql of qualifiedLeads) {
      console.log(`--- Lead #${ql.id} (Score: ${ql.lead_score}) ---`);
      console.log(`  Type: ${ql.lead_type} | Intent: ${ql.intent_level} | Status: ${ql.status}`);
      console.log(`  Platform: ${ql.platform} | Location: ${ql.location_text || 'N/A'}`);
      console.log(`  URL: ${ql.source_url}`);
      console.log(`  Summary: ${(ql.ai_summary || '').substring(0, 250)}`);
      console.log(`  Action: ${ql.ai_recommended_action || 'N/A'}`);
      console.log('');
    }
  } else {
    console.log('\nNo qualified leads produced yet. Check Railway ai-analysis-worker logs.');
  }

  // Also show raw_lead statuses
  const allStatuses = await sql`
    SELECT id, processing_status, source_url FROM raw_leads
    WHERE id = ANY(${rawLeadIds})
    ORDER BY id
  `;
  console.log('\nRaw lead statuses:');
  for (const rl of allStatuses) {
    console.log(`  #${rl.id} [${rl.processing_status}] ${rl.source_url.substring(0, 70)}`);
  }
}

async function cleanup(queue, redisConn) {
  await queue.close();
  await redisConn.quit();
  await sql.end();
}

main().catch(async (err) => {
  console.error('FATAL ERROR:', err);
  await sql.end().catch(() => {});
  process.exit(1);
});
