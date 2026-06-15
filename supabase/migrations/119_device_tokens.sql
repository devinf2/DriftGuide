-- WS-G retention/notifications: per-device Expo push tokens.
--
-- One row per (user, device push token). The client upserts on the unique
-- `expo_push_token` after the user opts in to notifications (see
-- src/services/pushNotifications.ts). The scheduled edge functions
-- (conditions-alerts, activity-push) read these rows with the service role to
-- fan out pushes. RLS lets a signed-in user manage only their own tokens;
-- the edge functions bypass RLS via the service-role key.

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_device_tokens_user_id on public.device_tokens(user_id);

alter table public.device_tokens enable row level security;

-- A user can see / write / remove only their own device tokens.
drop policy if exists "device_tokens_select_own" on public.device_tokens;
create policy "device_tokens_select_own" on public.device_tokens
  for select using (auth.uid() = user_id);

drop policy if exists "device_tokens_insert_own" on public.device_tokens;
create policy "device_tokens_insert_own" on public.device_tokens
  for insert with check (auth.uid() = user_id);

drop policy if exists "device_tokens_update_own" on public.device_tokens;
create policy "device_tokens_update_own" on public.device_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "device_tokens_delete_own" on public.device_tokens;
create policy "device_tokens_delete_own" on public.device_tokens
  for delete using (auth.uid() = user_id);

-- Keep updated_at fresh on upsert/update.
create or replace function public.touch_device_tokens_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_device_tokens_updated_at on public.device_tokens;
create trigger trg_device_tokens_updated_at
  before update on public.device_tokens
  for each row execute function public.touch_device_tokens_updated_at();

comment on table public.device_tokens is
  'WS-G: Expo push tokens per device. Read by scheduled edge functions (service role) to send pushes.';

-- ---------------------------------------------------------------------------
-- Cron for the two scheduled push workers (conditions-alerts, activity-push).
--
-- Left COMMENTED OUT because it needs project-specific values that aren't known
-- at migration-author time: the project's functions URL and a CRON_SECRET (set
-- as a function secret AND embedded in the call below). Run this once after the
-- functions are deployed, substituting <PROJECT_REF> and <CRON_SECRET>:
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--
--   -- Friend activity: poll unprocessed activity_events every 5 minutes.
--   select cron.schedule('activity-push', '*/5 * * * *', $$
--     select net.http_post(
--       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/activity-push',
--       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
--       body := '{}'::jsonb
--     );
--   $$);
--
--   -- Conditions alerts: once daily at 13:00 UTC (~morning across US time zones).
--   select cron.schedule('conditions-alerts', '0 13 * * *', $$
--     select net.http_post(
--       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/conditions-alerts',
--       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
--       body := '{}'::jsonb
--     );
--   $$);
-- ---------------------------------------------------------------------------
