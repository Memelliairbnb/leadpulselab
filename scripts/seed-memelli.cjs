const postgres = require('/Users/thebooth/ai-lead-hunter/packages/db/node_modules/postgres');

const sql = postgres('postgresql://postgres:GLGUwEndhZBYWITgOdRvPNjktGrlsDHh@metro.proxy.rlwy.net:19515/railway');

async function seed() {
  console.log('Seeding Memelli tenant...');

  await sql.begin(async (tx) => {
    // 1. Create admin user
    const [user] = await tx`
      INSERT INTO users (email, password_hash, full_name, is_active)
      VALUES ('admin@memelli.com', '$2b$10$placeholder.change.this.immediately.000000000000', 'Memelli Admin', true)
      ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
      RETURNING id
    `;
    console.log('Admin user id:', user.id);

    // 2. Create tenant
    const [tenant] = await tx`
      INSERT INTO tenants (name, slug, industry, plan, is_active, onboarding_template, max_leads_per_month, max_sources, max_users)
      VALUES ('Memelli', 'memelli', 'Financial Services', 'pro', true, 'credit_repair', 10000, 20, 10)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;
    console.log('Tenant id:', tenant.id);

    // 3. Link admin to tenant
    await tx`
      INSERT INTO tenant_members (tenant_id, user_id, role)
      VALUES (${tenant.id}, ${user.id}, 'owner')
      ON CONFLICT DO NOTHING
    `;
    console.log('Tenant member linked');

    // 4. Insert lead types
    const leadTypes = [
      { name: 'credit_repair', displayName: 'Credit Repair', description: 'Person with credit issues, collections, charge-offs, low scores needing cleanup', priority: 10, color: '#EF4444' },
      { name: 'personal_funding', displayName: 'Personal Funding', description: 'Person needing personal loans or lines of credit', priority: 8, color: '#F59E0B' },
      { name: 'business_funding', displayName: 'Business Funding', description: 'Business owner needing capital but blocked by credit/profile issues', priority: 9, color: '#3B82F6' },
      { name: 'mortgage_readiness', displayName: 'Mortgage Readiness', description: 'Person denied for mortgage or preparing to buy but credit is insufficient', priority: 9, color: '#8B5CF6' },
      { name: 'realtor_referral', displayName: 'Realtor Referral', description: "Real estate agent with clients who can't qualify due to credit", priority: 7, color: '#10B981' },
      { name: 'broker_referral', displayName: 'Broker Referral', description: 'Mortgage broker with credit-challenged clients', priority: 7, color: '#06B6D4' },
    ];

    for (const lt of leadTypes) {
      await tx`
        INSERT INTO tenant_lead_types (tenant_id, name, display_name, description, priority, color)
        VALUES (${tenant.id}, ${lt.name}, ${lt.displayName}, ${lt.description}, ${lt.priority}, ${lt.color})
        ON CONFLICT DO NOTHING
      `;
    }
    console.log('Inserted 6 lead types');

    // Build lead type lookup
    const ltRows = await tx`SELECT id, name FROM tenant_lead_types WHERE tenant_id = ${tenant.id}`;
    const ltMap = {};
    for (const r of ltRows) ltMap[r.name] = r.id;

    // 5. Insert scoring model
    let smId;
    const [scoringModel] = await tx`
      INSERT INTO tenant_scoring_models (tenant_id, name, is_active, claude_weight, rules_weight, hot_threshold, strong_threshold, nurture_threshold)
      VALUES (${tenant.id}, 'default', true, 0.60, 0.40, 85, 70, 50)
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (scoringModel) {
      smId = scoringModel.id;
    } else {
      const [existing] = await tx`SELECT id FROM tenant_scoring_models WHERE tenant_id = ${tenant.id} AND name = 'default'`;
      smId = existing.id;
    }
    console.log('Scoring model id:', smId);

    // 6. Insert scoring signals
    const signals = [
      { signalKey: 'denied_loan', signalPattern: 'denied for loan|denied for mortgage|turned down|rejected', weight: 35, description: 'Directly mentions loan or mortgage denial' },
      { signalKey: 'asked_for_help', signalPattern: 'help me|fix my|need help|how to|looking for', weight: 25, description: 'Actively asking for help' },
      { signalKey: 'urgent_timeline', signalPattern: 'asap|urgent|quickly|fast|immediately|this month', weight: 20, description: 'Urgent need for resolution' },
      { signalKey: 'professional_referral', signalPattern: 'realtor|broker|agent|loan officer|my clients', weight: 15, description: 'Professional with referral potential' },
      { signalKey: 'credit_pain', signalPattern: 'collections|charge-off|late payments|inquiries|low score|bad credit', weight: 10, description: 'Specific credit pain terms' },
      { signalKey: 'vague_finance', signalPattern: 'investment tips|stock market|crypto|savings account|retirement', weight: -20, description: 'General finance content, not credit pain' },
    ];

    for (const s of signals) {
      await tx`
        INSERT INTO tenant_scoring_signals (scoring_model_id, signal_key, signal_pattern, weight, description)
        VALUES (${smId}, ${s.signalKey}, ${s.signalPattern}, ${s.weight}, ${s.description})
        ON CONFLICT DO NOTHING
      `;
    }
    console.log('Inserted 6 scoring signals');

    // 7. Insert outreach templates
    const templates = [
      { name: 'Credit Repair First Contact', leadTypeName: 'credit_repair', channel: 'dm', body: "Hi \u2014 I came across your post about dealing with credit challenges. A lot of people don't realize those items can be disputed and removed with the right approach. We specialize in helping people clean up their credit profile so they can qualify for the funding and approvals they need. Happy to share how our review process works if you're interested.", tone: 'warm' },
      { name: 'Mortgage Readiness First Contact', leadTypeName: 'mortgage_readiness', channel: 'dm', body: "Hey \u2014 I noticed you mentioned being turned down for a mortgage due to credit. That's actually more common than you'd think, and in most cases the profile can be improved faster than people expect. We help people get mortgage-ready by addressing the specific items holding their score back. Would you like to learn more about how it works?", tone: 'warm' },
      { name: 'Business Funding First Contact', leadTypeName: 'business_funding', channel: 'dm', body: "Hi \u2014 I saw your post about needing business capital but running into issues with your credit profile. We work with business owners to get their personal and business credit cleaned up so they can access real funding options. If you'd like, I can walk you through what we typically see and how fast things can move.", tone: 'warm' },
      { name: 'Realtor Referral Partner', leadTypeName: 'realtor_referral', channel: 'dm', body: "Hey \u2014 I know how frustrating it is when buyers are excited but can't qualify because of credit issues. We partner with agents to help their clients get mortgage-ready faster. Our team handles the credit cleanup so your clients come back qualified. Want to chat about how we could work together?", tone: 'professional' },
    ];

    for (const t of templates) {
      await tx`
        INSERT INTO tenant_outreach_templates (tenant_id, lead_type_id, name, channel, body_template, tone)
        VALUES (${tenant.id}, ${ltMap[t.leadTypeName] || null}, ${t.name}, ${t.channel}, ${t.body}, ${t.tone})
      `;
    }
    console.log('Inserted 4 outreach templates');

    // 8. Insert AI config
    await tx`
      INSERT INTO tenant_ai_config (tenant_id, industry_context, classification_instructions, example_signals_json, irrelevant_signals_json)
      VALUES (
        ${tenant.id},
        'We are a financial services company that helps people with credit repair, personal funding, business funding, mortgage readiness, and referral partnerships with real estate and mortgage professionals. We identify people publicly discussing credit challenges, loan denials, and funding needs.',
        'Pay special attention to signals of loan/mortgage denial, active credit disputes, collections or charge-offs mentioned, and professionals who work with clients needing credit help.',
        ${JSON.stringify(["I was denied for a mortgage because of my credit score", "Does anyone know how to remove collections from my report?", "My business loan was rejected, need help with credit", "I have a client who wants to buy but their credit is too low"])}::jsonb,
        ${JSON.stringify(["investment advice", "stock tips", "cryptocurrency", "savings accounts", "retirement planning", "insurance quotes"])}::jsonb
      )
      ON CONFLICT (tenant_id) DO NOTHING
    `;
    console.log('Inserted AI config');

    // 9. Insert keyword categories and keywords
    const kwCategories = [
      { name: 'Credit Pain', keywords: [
        { keyword: 'bad credit help', type: 'phrase' }, { keyword: 'fix my credit', type: 'phrase' },
        { keyword: 'collections on my report', type: 'phrase' }, { keyword: 'charge-offs', type: 'phrase' },
        { keyword: 'remove inquiries', type: 'phrase' }, { keyword: 'credit score too low', type: 'phrase' },
        { keyword: 'credit repair near me', type: 'phrase' },
      ]},
      { name: 'Loan Denial', keywords: [
        { keyword: 'denied for loan', type: 'phrase' }, { keyword: 'denied for mortgage', type: 'phrase' },
        { keyword: 'denied business loan', type: 'phrase' }, { keyword: 'get approved with bad credit', type: 'phrase' },
        { keyword: 'low score home loan', type: 'phrase' },
      ]},
      { name: 'Funding Need', keywords: [
        { keyword: 'need business funding', type: 'phrase' }, { keyword: 'help qualify for funding', type: 'phrase' },
        { keyword: 'preparing to buy a home but credit is bad', type: 'phrase' },
      ]},
      { name: 'Referral Signals', keywords: [
        { keyword: 'clients do not qualify because of credit', type: 'phrase' },
        { keyword: 'mortgage clients need credit help', type: 'phrase' },
        { keyword: 'business owner needs funding but profile not ready', type: 'phrase' },
      ]},
      { name: 'Hashtags', keywords: [
        { keyword: '#badcredit', type: 'hashtag' }, { keyword: '#creditrepair', type: 'hashtag' },
        { keyword: '#fixmycredit', type: 'hashtag' }, { keyword: '#loanrejected', type: 'hashtag' },
        { keyword: '#mortgagedenied', type: 'hashtag' }, { keyword: '#creditscore', type: 'hashtag' },
        { keyword: '#businessfunding', type: 'hashtag' }, { keyword: '#fundinghelp', type: 'hashtag' },
      ]},
    ];

    let totalKw = 0;
    for (const cat of kwCategories) {
      let catId;
      const [catRow] = await tx`
        INSERT INTO keyword_categories (tenant_id, name)
        VALUES (${tenant.id}, ${cat.name})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (catRow) {
        catId = catRow.id;
      } else {
        const [existing] = await tx`SELECT id FROM keyword_categories WHERE tenant_id = ${tenant.id} AND name = ${cat.name}`;
        catId = existing.id;
      }

      for (const kw of cat.keywords) {
        await tx`
          INSERT INTO keyword_library (tenant_id, category_id, keyword, keyword_type)
          VALUES (${tenant.id}, ${catId}, ${kw.keyword}, ${kw.type})
          ON CONFLICT DO NOTHING
        `;
        totalKw++;
      }
    }
    console.log('Inserted 5 keyword categories,', totalKw, 'keywords');

    // 10. Insert vertical template record
    await tx`
      INSERT INTO vertical_templates (name, display_name, industry, description, config_json)
      VALUES ('credit_repair', 'Credit Repair & Financial Services', 'Financial Services',
        'For credit repair companies, funding brokers, and financial service providers helping people improve their credit and access funding.',
        '{}'::jsonb)
      ON CONFLICT (name) DO NOTHING
    `;
    console.log('Inserted vertical template record');
  });

  console.log('\nMemelli tenant seeded successfully!');
  await sql.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  sql.end().then(() => process.exit(1));
});
