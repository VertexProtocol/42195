-- Migration 029: drop the invite label
--
-- `label` was a note to the owner about who a link had been meant for, and it
-- made sense while every link was one runner's key: a list of five pending
-- invites needed to say which was whose.
--
-- Migration 028 collapsed that list to one link per group, shared with
-- everyone at once. A single link addressed to nobody in particular has no
-- "who this was meant for", so nothing ever wrote the column and the group
-- screen only read it to fall through to the expiry text. A column that is
-- always null is a question the schema keeps asking and the app keeps not
-- answering.
--
-- accepted_at and accepted_by stay. They are equally inert, but they hold the
-- record of links that were spent under the one-use model, and that record is
-- not reconstructible once dropped.

alter table public.shared_goal_invites
  drop column if exists label;
