-- Cached GPS/HR/pace/altitude time-series for an activity.
-- Stored as JSONB (array of StreamPoint objects) so we avoid
-- hundreds of rows per activity in a relational table.
-- Populated lazily the first time a user opens the activity detail.
create table if not exists activity_streams (
  activity_id  uuid primary key references activities(id) on delete cascade,
  points       jsonb not null,
  fetched_at   timestamptz not null default now()
);

alter table activity_streams enable row level security;

create policy "Users read own activity streams" on activity_streams
  for select using (
    exists (
      select 1 from activities
      where activities.id = activity_streams.activity_id
        and activities.user_id = auth.uid()
    )
  );

-- Cached lap splits for an activity.
-- Populated lazily the first time a user opens the activity detail.
create table if not exists activity_laps (
  activity_id  uuid primary key references activities(id) on delete cascade,
  laps         jsonb not null,
  fetched_at   timestamptz not null default now()
);

alter table activity_laps enable row level security;

create policy "Users read own activity laps" on activity_laps
  for select using (
    exists (
      select 1 from activities
      where activities.id = activity_laps.activity_id
        and activities.user_id = auth.uid()
    )
  );
