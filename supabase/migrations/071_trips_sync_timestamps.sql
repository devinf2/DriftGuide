-- Client-reported timestamps for survey closure and full bundle sync (offline-first outbox).

alter table public.trips
  add column if not exists survey_submitted_at timestamptz;

alter table public.trips
  add column if not exists last_full_sync_at timestamptz;

comment on column public.trips.survey_submitted_at is 'When the post-trip survey (rating) was persisted to the server; set by app on successful sync.';
comment on column public.trips.last_full_sync_at is 'When the app last completed a full trip bundle upload for this row.';
