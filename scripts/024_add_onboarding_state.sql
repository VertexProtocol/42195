-- Migration 024: remember that the runner closed the "Get started" checklist.
--
-- The first-run guide used to hold its dismissal in React state alone, so
-- "Hide" lasted until the next reload and the full-screen welcome came back on
-- every launch. The timestamp makes the dismissal belong to the account rather
-- than to the tab.
--
-- Null means the checklist is live. Setting it back to null is how Profile →
-- Get started reopens it, so this is a nullable timestamp rather than a
-- boolean flag: it also records when the runner closed it.

alter table public.profiles
  add column if not exists onboarding_dismissed_at timestamptz;
