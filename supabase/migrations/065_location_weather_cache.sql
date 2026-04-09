-- Shared OpenWeather snapshot per catalog/custom location (Edge Function upserts; 1h TTL enforced in app layer).

create table public.location_weather_cache (
  location_id uuid primary key references public.locations (id) on delete cascade,
  current_json jsonb not null default '{}'::jsonb,
  forecast_json jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.location_weather_cache is 'Normalized current + hourly forecast cache for OpenWeather; refreshed at most once per hour per location via weather-proxy Edge Function.';

create index idx_location_weather_cache_fetched_at on public.location_weather_cache (fetched_at desc);

alter table public.location_weather_cache enable row level security;

-- Readable only for locations the user can already see (matches locations select policy).
create policy "location_weather_cache_select_visible_locations"
  on public.location_weather_cache
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.locations l
      where l.id = location_weather_cache.location_id
        and (coalesce(l.is_public, true) = true or l.created_by = auth.uid())
    )
  );

-- Writes only via service role (Edge Function); no insert/update policies for authenticated.
