-- Seed Memelli as Tenant #1 with Credit Repair vertical template
-- Run against Railway Postgres

BEGIN;

-- 1. Create admin user (bcrypt hash of 'changeme123' - user should change immediately)
INSERT INTO users (email, password_hash, full_name, is_active)
VALUES ('admin@memelli.com', '$2b$10$dummyhashchangethisimmediately000000000000000000000', 'Memelli Admin', true)
ON CONFLICT (email) DO NOTHING;

-- 2. Create Memelli tenant
INSERT INTO tenants (name, slug, industry, plan, is_active, onboarding_template, max_leads_per_month, max_sources, max_users)
VALUES ('Memelli', 'memelli', 'Financial Services', 'pro', true, 'credit_repair', 10000, 20, 10)
ON CONFLICT (slug) DO NOTHING;

-- 3. Link admin user to tenant as owner
INSERT INTO tenant_members (tenant_id, user_id, role)
SELECT t.id, u.id, 'owner'
FROM tenants t, users u
WHERE t.slug = 'memelli' AND u.email = 'admin@memelli.com'
ON CONFLICT DO NOTHING;

-- 4. Insert 6 lead types
INSERT INTO tenant_lead_types (tenant_id, name, display_name, description, priority, color)
SELECT t.id, v.name, v.display_name, v.description, v.priority, v.color
FROM tenants t,
(VALUES
  ('credit_repair', 'Credit Repair', 'Person with credit issues, collections, charge-offs, low scores needing cleanup', 10, '#EF4444'),
  ('personal_funding', 'Personal Funding', 'Person needing personal loans or lines of credit', 8, '#F59E0B'),
  ('business_funding', 'Business Funding', 'Business owner needing capital but blocked by credit/profile issues', 9, '#3B82F6'),
  ('mortgage_readiness', 'Mortgage Readiness', 'Person denied for mortgage or preparing to buy but credit is insufficient', 9, '#8B5CF6'),
  ('realtor_referral', 'Realtor Referral', 'Real estate agent with clients who can''t qualify due to credit', 7, '#10B981'),
  ('broker_referral', 'Broker Referral', 'Mortgage broker with credit-challenged clients', 7, '#06B6D4')
) AS v(name, display_name, description, priority, color)
WHERE t.slug = 'memelli'
ON CONFLICT DO NOTHING;

-- 5. Insert scoring model
INSERT INTO tenant_scoring_models (tenant_id, name, is_active, claude_weight, rules_weight, hot_threshold, strong_threshold, nurture_threshold)
SELECT t.id, 'default', true, 0.60, 0.40, 85, 70, 50
FROM tenants t WHERE t.slug = 'memelli'
ON CONFLICT DO NOTHING;

-- 6. Insert 6 scoring signals
INSERT INTO tenant_scoring_signals (scoring_model_id, signal_key, signal_pattern, weight, description)
SELECT sm.id, v.signal_key, v.signal_pattern, v.weight, v.description
FROM tenant_scoring_models sm
JOIN tenants t ON sm.tenant_id = t.id
CROSS JOIN (VALUES
  ('denied_loan', 'denied for loan|denied for mortgage|turned down|rejected', 35, 'Directly mentions loan or mortgage denial'),
  ('asked_for_help', 'help me|fix my|need help|how to|looking for', 25, 'Actively asking for help'),
  ('urgent_timeline', 'asap|urgent|quickly|fast|immediately|this month', 20, 'Urgent need for resolution'),
  ('professional_referral', 'realtor|broker|agent|loan officer|my clients', 15, 'Professional with referral potential'),
  ('credit_pain', 'collections|charge-off|late payments|inquiries|low score|bad credit', 10, 'Specific credit pain terms'),
  ('vague_finance', 'investment tips|stock market|crypto|savings account|retirement', -20, 'General finance content, not credit pain')
) AS v(signal_key, signal_pattern, weight, description)
WHERE t.slug = 'memelli' AND sm.name = 'default'
ON CONFLICT DO NOTHING;

-- 7. Insert outreach templates (linking to lead types by name)
INSERT INTO tenant_outreach_templates (tenant_id, lead_type_id, name, channel, subject_template, body_template, tone)
SELECT t.id, lt.id, v.name, v.channel, v.subject_template, v.body_template, v.tone
FROM tenants t
CROSS JOIN (VALUES
  ('Credit Repair First Contact', 'credit_repair', 'dm', NULL, 'Hi — I came across your post about dealing with credit challenges. A lot of people don''t realize those items can be disputed and removed with the right approach. We specialize in helping people clean up their credit profile so they can qualify for the funding and approvals they need. Happy to share how our review process works if you''re interested.', 'warm'),
  ('Mortgage Readiness First Contact', 'mortgage_readiness', 'dm', NULL, 'Hey — I noticed you mentioned being turned down for a mortgage due to credit. That''s actually more common than you''d think, and in most cases the profile can be improved faster than people expect. We help people get mortgage-ready by addressing the specific items holding their score back. Would you like to learn more about how it works?', 'warm'),
  ('Business Funding First Contact', 'business_funding', 'dm', NULL, 'Hi — I saw your post about needing business capital but running into issues with your credit profile. We work with business owners to get their personal and business credit cleaned up so they can access real funding options. If you''d like, I can walk you through what we typically see and how fast things can move.', 'warm'),
  ('Realtor Referral Partner', 'realtor_referral', 'dm', NULL, 'Hey — I know how frustrating it is when buyers are excited but can''t qualify because of credit issues. We partner with agents to help their clients get mortgage-ready faster. Our team handles the credit cleanup so your clients come back qualified. Want to chat about how we could work together?', 'professional')
) AS v(name, lead_type_name, channel, subject_template, body_template, tone)
LEFT JOIN tenant_lead_types lt ON lt.tenant_id = t.id AND lt.name = v.lead_type_name
WHERE t.slug = 'memelli';

-- 8. Insert AI config
INSERT INTO tenant_ai_config (tenant_id, industry_context, classification_instructions, example_signals_json, irrelevant_signals_json)
SELECT t.id,
  'We are a financial services company that helps people with credit repair, personal funding, business funding, mortgage readiness, and referral partnerships with real estate and mortgage professionals. We identify people publicly discussing credit challenges, loan denials, and funding needs.',
  'Pay special attention to signals of loan/mortgage denial, active credit disputes, collections or charge-offs mentioned, and professionals who work with clients needing credit help.',
  '["I was denied for a mortgage because of my credit score", "Does anyone know how to remove collections from my report?", "My business loan was rejected, need help with credit", "I have a client who wants to buy but their credit is too low"]'::jsonb,
  '["investment advice", "stock tips", "cryptocurrency", "savings accounts", "retirement planning", "insurance quotes"]'::jsonb
FROM tenants t WHERE t.slug = 'memelli'
ON CONFLICT DO NOTHING;

-- 9. Insert keyword categories and keywords
-- Credit Pain
INSERT INTO keyword_categories (tenant_id, name) SELECT t.id, 'Credit Pain' FROM tenants t WHERE t.slug = 'memelli' ON CONFLICT DO NOTHING;
INSERT INTO keyword_library (tenant_id, category_id, keyword, keyword_type)
SELECT t.id, kc.id, v.keyword, v.keyword_type
FROM tenants t
JOIN keyword_categories kc ON kc.tenant_id = t.id AND kc.name = 'Credit Pain'
CROSS JOIN (VALUES
  ('bad credit help', 'phrase'), ('fix my credit', 'phrase'), ('collections on my report', 'phrase'),
  ('charge-offs', 'phrase'), ('remove inquiries', 'phrase'), ('credit score too low', 'phrase'), ('credit repair near me', 'phrase')
) AS v(keyword, keyword_type)
WHERE t.slug = 'memelli'
ON CONFLICT DO NOTHING;

-- Loan Denial
INSERT INTO keyword_categories (tenant_id, name) SELECT t.id, 'Loan Denial' FROM tenants t WHERE t.slug = 'memelli' ON CONFLICT DO NOTHING;
INSERT INTO keyword_library (tenant_id, category_id, keyword, keyword_type)
SELECT t.id, kc.id, v.keyword, v.keyword_type
FROM tenants t
JOIN keyword_categories kc ON kc.tenant_id = t.id AND kc.name = 'Loan Denial'
CROSS JOIN (VALUES
  ('denied for loan', 'phrase'), ('denied for mortgage', 'phrase'), ('denied business loan', 'phrase'),
  ('get approved with bad credit', 'phrase'), ('low score home loan', 'phrase')
) AS v(keyword, keyword_type)
WHERE t.slug = 'memelli'
ON CONFLICT DO NOTHING;

-- Funding Need
INSERT INTO keyword_categories (tenant_id, name) SELECT t.id, 'Funding Need' FROM tenants t WHERE t.slug = 'memelli' ON CONFLICT DO NOTHING;
INSERT INTO keyword_library (tenant_id, category_id, keyword, keyword_type)
SELECT t.id, kc.id, v.keyword, v.keyword_type
FROM tenants t
JOIN keyword_categories kc ON kc.tenant_id = t.id AND kc.name = 'Funding Need'
CROSS JOIN (VALUES
  ('need business funding', 'phrase'), ('help qualify for funding', 'phrase'), ('preparing to buy a home but credit is bad', 'phrase')
) AS v(keyword, keyword_type)
WHERE t.slug = 'memelli'
ON CONFLICT DO NOTHING;

-- Referral Signals
INSERT INTO keyword_categories (tenant_id, name) SELECT t.id, 'Referral Signals' FROM tenants t WHERE t.slug = 'memelli' ON CONFLICT DO NOTHING;
INSERT INTO keyword_library (tenant_id, category_id, keyword, keyword_type)
SELECT t.id, kc.id, v.keyword, v.keyword_type
FROM tenants t
JOIN keyword_categories kc ON kc.tenant_id = t.id AND kc.name = 'Referral Signals'
CROSS JOIN (VALUES
  ('clients do not qualify because of credit', 'phrase'), ('mortgage clients need credit help', 'phrase'), ('business owner needs funding but profile not ready', 'phrase')
) AS v(keyword, keyword_type)
WHERE t.slug = 'memelli'
ON CONFLICT DO NOTHING;

-- Hashtags
INSERT INTO keyword_categories (tenant_id, name) SELECT t.id, 'Hashtags' FROM tenants t WHERE t.slug = 'memelli' ON CONFLICT DO NOTHING;
INSERT INTO keyword_library (tenant_id, category_id, keyword, keyword_type)
SELECT t.id, kc.id, v.keyword, v.keyword_type
FROM tenants t
JOIN keyword_categories kc ON kc.tenant_id = t.id AND kc.name = 'Hashtags'
CROSS JOIN (VALUES
  ('#badcredit', 'hashtag'), ('#creditrepair', 'hashtag'), ('#fixmycredit', 'hashtag'), ('#loanrejected', 'hashtag'),
  ('#mortgagedenied', 'hashtag'), ('#creditscore', 'hashtag'), ('#businessfunding', 'hashtag'), ('#fundinghelp', 'hashtag')
) AS v(keyword, keyword_type)
WHERE t.slug = 'memelli'
ON CONFLICT DO NOTHING;

-- 10. Insert vertical template record
INSERT INTO vertical_templates (name, display_name, industry, description, config_json)
VALUES (
  'credit_repair',
  'Credit Repair & Financial Services',
  'Financial Services',
  'For credit repair companies, funding brokers, and financial service providers helping people improve their credit and access funding.',
  '{}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

COMMIT;
