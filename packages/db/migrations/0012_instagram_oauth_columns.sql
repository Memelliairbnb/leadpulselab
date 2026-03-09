-- Add OAuth token columns to instagram_accounts
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS access_token TEXT;
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS token_scope TEXT;
