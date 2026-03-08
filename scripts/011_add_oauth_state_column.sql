-- Migration 011: Add oauth_state column to strava_tokens
--
-- This column stores the CSRF state token during OAuth flow.
-- It's set when the user initiates Strava connection and verified
-- in the callback to prevent CSRF attacks.

-- Add oauth_state column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'strava_tokens' AND column_name = 'oauth_state'
  ) THEN
    ALTER TABLE strava_tokens ADD COLUMN oauth_state text;
  END IF;
END $$;

-- Update the base SQL file comment (for documentation)
COMMENT ON COLUMN strava_tokens.oauth_state IS 'Temporary CSRF state token used during OAuth flow. Set on auth initiation, cleared on callback.';
