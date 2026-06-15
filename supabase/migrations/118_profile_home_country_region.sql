-- International-friendly home location: a country (ISO 3166-1 name or 2-letter code)
-- plus an optional region/state. `home_state` is kept for backward-compat: when the
-- country is the US it is still populated so the offline location-snapshot filter
-- (which keys off US state bounding boxes) keeps working.
alter table public.profiles
  add column if not exists home_country text,
  add column if not exists home_region text;

comment on column public.profiles.home_country is 'User home country (full name or ISO 3166-1 alpha-2 code).';
comment on column public.profiles.home_region is 'User home region/state within the country (free text; US states also mirrored to home_state).';
