-- Add a state column so the locations catalog can be organized/filtered by US state.
-- USPS 2-letter codes (e.g. 'UT', 'FL'). Nullable so non-US or unknown spots are allowed.

alter table public.locations
  add column if not exists state text;

comment on column public.locations.state is 'USPS 2-letter state code (e.g. UT, FL). Null = unknown / non-US.';

create index if not exists idx_locations_state
  on public.locations(state)
  where deleted_at is null;

-- Backfill: the only existing rows at this point are the original Utah seeds.
update public.locations
set state = 'UT'
where state is null;
