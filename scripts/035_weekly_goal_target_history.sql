-- Migration 035: what a recurring target was, in the week it was worked to
--
-- A recurring weekly goal is one row applying to many weeks, so `target` is
-- the number it holds now. Changing 40 km to 50 changed it in every week
-- behind the runner too — a month they finished on 42 km flipped from
-- comfortably over to eight short, against a target that did not exist while
-- they were running it.
--
-- The version of this fix that writes a row per week needs something to write
-- those rows every Monday, and there is no scheduler here. There does not need
-- to be: the row is not missing, the *dates* are. `target_history` holds the
-- periods that have closed, each `{from, until, target}` with Mondays as
-- YYYY-MM-DD, half-open so the week a change was made in belongs to the new
-- number. The current `target` covers everything after the last of them.
--
-- Defaulting to an empty array is the honest reading of every row that already
-- exists: nothing recorded when — or whether — the number ever moved, so the
-- only claim that can be made is the one the app already makes, that it has
-- held this value throughout. Every change from here is dated.
--
-- Shaped after `goal_preferences.notes_history`, which versions notes the same
-- way on a neighbouring table.

alter table public.weekly_goals
  add column if not exists target_history jsonb not null default '[]'::jsonb;
