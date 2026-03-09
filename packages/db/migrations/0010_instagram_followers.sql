-- 0010_instagram_followers.sql
-- Follower collection tables for Instagram pipeline

-- ─── Target accounts we want to collect followers from ──────────────────────

CREATE TABLE IF NOT EXISTS instagram_target_accounts (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  candidate_id  INTEGER REFERENCES instagram_profile_candidates(id),
  instagram_handle VARCHAR(255) NOT NULL,
  profile_url   TEXT,
  display_name  VARCHAR(500),
  follower_count INTEGER,
  category      VARCHAR(255),
  is_competitor BOOLEAN NOT NULL DEFAULT FALSE,
  collection_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  followers_collected INTEGER NOT NULL DEFAULT 0,
  last_collection_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, instagram_handle)
);

CREATE INDEX IF NOT EXISTS idx_ig_target_tenant ON instagram_target_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ig_target_status ON instagram_target_accounts(collection_status);

-- ─── Collected followers ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instagram_collected_followers (
  id                    SERIAL PRIMARY KEY,
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id),
  target_account_id     INTEGER NOT NULL REFERENCES instagram_target_accounts(id),
  follower_handle       VARCHAR(255) NOT NULL,
  follower_profile_url  TEXT,
  follower_display_name VARCHAR(500),
  follower_bio          TEXT,
  is_business           BOOLEAN,
  is_private            BOOLEAN,
  category              VARCHAR(255),
  public_email          VARCHAR(500),
  public_phone          VARCHAR(100),
  website_url           TEXT,
  location_clues        TEXT,
  follower_count        INTEGER,
  following_count       INTEGER,
  processing_status     VARCHAR(50) NOT NULL DEFAULT 'raw',
  qualification_score   INTEGER,
  collected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, target_account_id, follower_handle)
);

CREATE INDEX IF NOT EXISTS idx_ig_follower_tenant     ON instagram_collected_followers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ig_follower_target     ON instagram_collected_followers(target_account_id);
CREATE INDEX IF NOT EXISTS idx_ig_follower_processing ON instagram_collected_followers(processing_status);
CREATE INDEX IF NOT EXISTS idx_ig_follower_score      ON instagram_collected_followers(qualification_score);

-- ─── Collection run tracking ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instagram_collection_runs (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  target_account_id   INTEGER NOT NULL REFERENCES instagram_target_accounts(id),
  status              VARCHAR(50) NOT NULL DEFAULT 'running',
  followers_collected INTEGER NOT NULL DEFAULT 0,
  cursor_position     TEXT,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_collection_runs_tenant ON instagram_collection_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ig_collection_runs_target ON instagram_collection_runs(target_account_id);
CREATE INDEX IF NOT EXISTS idx_ig_collection_runs_status ON instagram_collection_runs(status);
