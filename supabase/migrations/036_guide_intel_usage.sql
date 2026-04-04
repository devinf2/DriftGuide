-- Per-user daily caps for guide-intel Edge function (rate limiting).
create table if not exists public.guide_intel_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  request_count integer not null default 0,
  primary key (user_id, day)
);

alter table public.guide_intel_usage enable row level security;

-- Only service role / Edge should write; users cannot read others' usage.
create policy "guide_intel_usage_no_user_select"
  on public.guide_intel_usage
  for select
  using (false);

create policy "guide_intel_usage_no_user_insert"
  on public.guide_intel_usage
  for insert
  with check (false);

create policy "guide_intel_usage_no_user_update"
  on public.guide_intel_usage
  for update
  using (false);
