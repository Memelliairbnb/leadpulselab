-- Instagram lead sourcing pipeline tables
-- Migration: 0009_instagram_tables.sql

-- ─── Discovery run tracking ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instagram_discovery_runs (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  search_query TEXT,
  search_type VARCHAR(30) NOT NULL,
  profiles_found INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_discovery_runs_tenant ON instagram_discovery_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ig_discovery_runs_status ON instagram_discovery_runs(status);
CREATE INDEX IF NOT EXISTS idx_ig_discovery_runs_search_type ON instagram_discovery_runs(search_type);
CREATE INDEX IF NOT EXISTS idx_ig_discovery_runs_created ON instagram_discovery_runs(created_at);

-- ─── Raw scraped profiles (Worker 1 output) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS raw_instagram_profiles (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  discovery_run_id INTEGER REFERENCES instagram_discovery_runs(id),
  instagram_handle VARCHAR(255) NOT NULL,
  profile_url TEXT,
  display_name VARCHAR(500),
  bio_text TEXT,
  category VARCHAR(255),
  website_url TEXT,
  public_email_candidate VARCHAR(500),
  public_phone_candidate VARCHAR(100),
  location_clues TEXT,
  follower_count INTEGER,
  following_count INTEGER,
  post_count INTEGER,
  is_business BOOLEAN,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  discovery_reason TEXT,
  raw_metadata_json JSONB,
  processing_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  text_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ig_profiles_tenant_handle ON raw_instagram_profiles(tenant_id, instagram_handle);
CREATE INDEX IF NOT EXISTS idx_ig_profiles_tenant ON raw_instagram_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ig_profiles_discovery_run ON raw_instagram_profiles(discovery_run_id);
CREATE INDEX IF NOT EXISTS idx_ig_profiles_processing ON raw_instagram_profiles(processing_status);
CREATE INDEX IF NOT EXISTS idx_ig_profiles_text_hash ON raw_instagram_profiles(text_hash);
CREATE INDEX IF NOT EXISTS idx_ig_profiles_created ON raw_instagram_profiles(created_at);

-- ─── Scrubbed / pre-qualified candidates (Worker 2 output) ──────────────────

CREATE TABLE IF NOT EXISTS instagram_profile_candidates (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  raw_profile_id INTEGER REFERENCES raw_instagram_profiles(id),
  instagram_handle VARCHAR(255),
  profile_url TEXT,
  display_name VARCHAR(500),
  bio_text TEXT,
  category VARCHAR(255),
  website_url TEXT,
  normalized_email VARCHAR(500),
  normalized_phone VARCHAR(100),
  profile_type VARCHAR(20) NOT NULL DEFAULT 'unclear',
  duplicate_status VARCHAR(20) NOT NULL DEFAULT 'unique',
  niche_fit_score INTEGER NOT NULL DEFAULT 0,
  contactability_score INTEGER NOT NULL DEFAULT 0,
  bio_quality_score INTEGER NOT NULL DEFAULT 0,
  overall_prequal_score INTEGER NOT NULL DEFAULT 0,
  prequal_status VARCHAR(20) NOT NULL DEFAULT 'enrich',
  scrub_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_candidates_tenant ON instagram_profile_candidates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ig_candidates_raw_profile ON instagram_profile_candidates(raw_profile_id);
CREATE INDEX IF NOT EXISTS idx_ig_candidates_prequal_status ON instagram_profile_candidates(prequal_status);
CREATE INDEX IF NOT EXISTS idx_ig_candidates_overall_score ON instagram_profile_candidates(overall_prequal_score);
CREATE INDEX IF NOT EXISTS idx_ig_candidates_profile_type ON instagram_profile_candidates(profile_type);
CREATE INDEX IF NOT EXISTS idx_ig_candidates_duplicate_status ON instagram_profile_candidates(duplicate_status);
CREATE INDEX IF NOT EXISTS idx_ig_candidates_created ON instagram_profile_candidates(created_at);

-- ─── Contact discovery results (Worker 3 intermediate) ──────────────────────

CREATE TABLE IF NOT EXISTS instagram_contact_candidates (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  candidate_id INTEGER NOT NULL REFERENCES instagram_profile_candidates(id) ON DELETE CASCADE,
  contact_type VARCHAR(30) NOT NULL,
  contact_value TEXT NOT NULL,
  source VARCHAR(30) NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_method VARCHAR(50),
  verification_result VARCHAR(50),
  priority_rank INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_contacts_tenant ON instagram_contact_candidates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ig_contacts_candidate ON instagram_contact_candidates(candidate_id);
CREATE INDEX IF NOT EXISTS idx_ig_contacts_type ON instagram_contact_candidates(contact_type);
CREATE INDEX IF NOT EXISTS idx_ig_contacts_verified ON instagram_contact_candidates(is_verified);

-- ─── Verification step tracking (Worker 3) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS instagram_verification_runs (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  candidate_id INTEGER NOT NULL REFERENCES instagram_profile_candidates(id) ON DELETE CASCADE,
  step_name VARCHAR(100) NOT NULL,
  step_status VARCHAR(20) NOT NULL,
  output_data_json JSONB,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_verification_candidate ON instagram_verification_runs(candidate_id);
CREATE INDEX IF NOT EXISTS idx_ig_verification_step ON instagram_verification_runs(step_name);
CREATE INDEX IF NOT EXISTS idx_ig_verification_status ON instagram_verification_runs(step_status);
CREATE INDEX IF NOT EXISTS idx_ig_verification_created ON instagram_verification_runs(created_at);

-- ─── Final scoring ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instagram_lead_scores (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  candidate_id INTEGER NOT NULL REFERENCES instagram_profile_candidates(id) ON DELETE CASCADE,
  niche_fit_score INTEGER NOT NULL,
  contactability_score INTEGER NOT NULL,
  verification_score INTEGER NOT NULL,
  final_qualification_score INTEGER NOT NULL,
  qualification_status VARCHAR(30) NOT NULL,
  contact_path_ranking JSONB,
  scoring_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_scores_tenant ON instagram_lead_scores(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ig_scores_candidate ON instagram_lead_scores(candidate_id);
CREATE INDEX IF NOT EXISTS idx_ig_scores_qualification ON instagram_lead_scores(qualification_status);
CREATE INDEX IF NOT EXISTS idx_ig_scores_final_score ON instagram_lead_scores(final_qualification_score);
CREATE INDEX IF NOT EXISTS idx_ig_scores_created ON instagram_lead_scores(created_at);
