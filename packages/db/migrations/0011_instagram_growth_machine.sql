-- Instagram Growth Machine tables
-- Auto-engage, scrape followers, generate content

-- ─── Connected Instagram accounts ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instagram_accounts (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  ig_user_id VARCHAR(255),
  ig_username VARCHAR(255) NOT NULL,
  encrypted_password TEXT,
  session_json TEXT,
  session_expires_at TIMESTAMPTZ,
  detected_niche VARCHAR(255),
  confirmed_niche VARCHAR(255),
  bio_text TEXT,
  profile_pic_url TEXT,
  follower_count INTEGER,
  following_count INTEGER,
  post_count INTEGER,
  is_business BOOLEAN,
  business_category VARCHAR(255),
  account_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  connected_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ig_accounts_tenant_username ON instagram_accounts(tenant_id, ig_username);
CREATE INDEX IF NOT EXISTS idx_ig_accounts_status ON instagram_accounts(account_status);
CREATE INDEX IF NOT EXISTS idx_ig_accounts_tenant ON instagram_accounts(tenant_id);

-- ─── Products linked to an Instagram account ─────────────────────────────────

CREATE TABLE IF NOT EXISTS instagram_account_products (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  product_name VARCHAR(255) NOT NULL,
  product_description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_account_products_account ON instagram_account_products(account_id);

-- ─── Target audiences linked to an Instagram account ─────────────────────────

CREATE TABLE IF NOT EXISTS instagram_account_audiences (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  audience_name VARCHAR(255) NOT NULL,
  audience_description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_account_audiences_account ON instagram_account_audiences(account_id);

-- ─── Per-account automation config ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instagram_account_config (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE UNIQUE,
  auto_follow BOOLEAN NOT NULL DEFAULT TRUE,
  auto_like BOOLEAN NOT NULL DEFAULT TRUE,
  auto_comment BOOLEAN NOT NULL DEFAULT TRUE,
  auto_dm BOOLEAN NOT NULL DEFAULT FALSE,
  auto_content BOOLEAN NOT NULL DEFAULT FALSE,
  daily_follow_limit INTEGER NOT NULL DEFAULT 10,
  daily_like_limit INTEGER NOT NULL DEFAULT 30,
  daily_comment_limit INTEGER NOT NULL DEFAULT 5,
  daily_dm_limit INTEGER NOT NULL DEFAULT 0,
  engagement_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  content_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ramp_week INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_account_config_account ON instagram_account_config(account_id);

-- ─── Engagement action log ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instagram_engagement_log (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  action_type VARCHAR(30) NOT NULL,
  target_handle VARCHAR(255),
  target_post_id VARCHAR(255),
  comment_text TEXT,
  dm_text TEXT,
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(30) NOT NULL DEFAULT 'success',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_engagement_account_action_created ON instagram_engagement_log(account_id, action_type, created_at);
CREATE INDEX IF NOT EXISTS idx_ig_engagement_account_created ON instagram_engagement_log(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ig_engagement_tenant ON instagram_engagement_log(tenant_id);

-- ─── Content schedule ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instagram_content_schedule (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  content_type VARCHAR(30) NOT NULL,
  caption TEXT,
  hashtags TEXT,
  image_url TEXT,
  video_url TEXT,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  ai_prompt TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_content_account_status ON instagram_content_schedule(account_id, status);
CREATE INDEX IF NOT EXISTS idx_ig_content_tenant ON instagram_content_schedule(tenant_id);

-- ─── DM campaigns ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instagram_dm_campaigns (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  campaign_name VARCHAR(255) NOT NULL,
  target_audience TEXT,
  message_template TEXT,
  ai_personalize BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  total_sent INTEGER NOT NULL DEFAULT 0,
  total_replied INTEGER NOT NULL DEFAULT 0,
  total_converted INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_dm_campaigns_account ON instagram_dm_campaigns(account_id);
CREATE INDEX IF NOT EXISTS idx_ig_dm_campaigns_tenant ON instagram_dm_campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ig_dm_campaigns_status ON instagram_dm_campaigns(status);

-- ─── DM messages ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instagram_dm_messages (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES instagram_dm_campaigns(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  recipient_handle VARCHAR(255) NOT NULL,
  message_text TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'queued',
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  reply_text TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_dm_messages_campaign_status ON instagram_dm_messages(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_ig_dm_messages_account ON instagram_dm_messages(account_id);
