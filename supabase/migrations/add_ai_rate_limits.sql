-- Track per-user AI request counts to enforce rate limits
-- One row per user per hour bucket; older buckets accumulate but are harmless.
CREATE TABLE IF NOT EXISTS ai_rate_limits (
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hour_bucket   timestamptz NOT NULL,  -- truncated to the hour
  request_count integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, hour_bucket)
);

-- Users can only see/modify their own rows
ALTER TABLE ai_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own rate limits"
  ON ai_rate_limits
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Atomic upsert-and-increment function called by the server-side rate limiter.
-- Runs as SECURITY DEFINER so the service role can bypass RLS for this operation.
CREATE OR REPLACE FUNCTION increment_ai_rate_limit(
  p_user_id    uuid,
  p_hour_bucket timestamptz
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO ai_rate_limits (user_id, hour_bucket, request_count)
  VALUES (p_user_id, p_hour_bucket, 1)
  ON CONFLICT (user_id, hour_bucket)
  DO UPDATE SET request_count = ai_rate_limits.request_count + 1
  RETURNING request_count INTO new_count;

  RETURN new_count;
END;
$$;
