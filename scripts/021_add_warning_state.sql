-- Add per-user warning state storage to profiles.
-- warning_state tracks cooldown timestamps per warning type so the proactive
-- training-warnings engine can avoid re-surfacing the same advisory more
-- often than the cooldown window (default 14 days).
--
-- Shape (Partial<Record<WarningType, { lastSurfacedAt: ISO | null }>>):
--   {
--     "elevated_acwr":     { "lastSurfacedAt": "2026-04-19T10:00:00Z" },
--     "prolonged_fatigue": { "lastSurfacedAt": null },
--     "hr_drift":          { "lastSurfacedAt": "2026-04-12T08:30:00Z" },
--     "pace_drift":        { "lastSurfacedAt": null }
--   }
alter table public.profiles
  add column if not exists warning_state jsonb default null;
