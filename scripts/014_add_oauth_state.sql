-- Add oauth_state column for CSRF fallback (mobile Safari cookie issue)
ALTER TABLE strava_tokens ADD COLUMN IF NOT EXISTS oauth_state text;
