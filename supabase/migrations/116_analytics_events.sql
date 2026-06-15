-- First-party product analytics. Events are written ONLY by the `analytics-ingest`
-- edge function using the service role, so RLS can stay fully closed for clients.
-- user_id is nullable (anonymous / guest browsing before signup is a key funnel signal).

create table if not exists public.analytics_events (
  id          uuid primary key default gen_random_uuid(),
  device_id   text not null,
  user_id     uuid references public.profiles(id) on delete set null,
  event       text not null,
  props       jsonb not null default '{}'::jsonb,
  session_id  text,
  platform    text,
  app_version text,
  -- Server-stamped receive time. Clients also send their own ts inside props.client_ts
  -- (added by the ingest function) so client/server skew can be inspected if needed.
  created_at  timestamptz not null default now()
);

create index if not exists idx_analytics_events_event_created_at
  on public.analytics_events (event, created_at);

create index if not exists idx_analytics_events_user_id
  on public.analytics_events (user_id) where user_id is not null;

-- Helpful for retention/funnel windows that scan by time across all events.
create index if not exists idx_analytics_events_created_at
  on public.analytics_events (created_at);

-- Lock the table down: no client (anon or authed) may read or write directly.
-- All inserts go through the service-role edge function.
alter table public.analytics_events enable row level security;
revoke all on public.analytics_events from anon, authenticated;
-- No policies are created, so RLS denies everything for anon/authenticated.
-- The service role bypasses RLS and is the only writer.
