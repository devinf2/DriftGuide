-- Normalized Utah land ownership polygons (source: Utah UGRC Land Ownership).
-- Raw shapefile is loaded into `land_ownership_raw` by supabase/import/import_land_ownership.sh,
-- then normalized into this table via supabase/import/normalize_land_ownership.sql.
-- This migration only defines the destination schema, indexes, and read policy.

create table if not exists public.land_ownership (
  id             bigint generated always as identity primary key,
  -- Coarse bucket the map styles + access copy key off of.
  ownership_type text not null
    check (ownership_type in ('private','federal','state','tribal','local','water','unknown')),
  agency         text,            -- managing agency, e.g. 'US Forest Service', 'BLM', 'SITLA'
  owner_name     text,            -- raw owner label from UGRC when more specific than agency
  admin_unit     text,            -- forest / park / district name when present
  access_status  text not null default 'unknown'
    check (access_status in ('public','restricted','unknown')),
  source         text not null default 'UGRC Land Ownership',
  source_updated date,
  geom           geometry(MultiPolygon, 4326) not null
);

-- Spatial index drives both ST_Contains tap queries and ST_Intersects tile clipping.
create index if not exists land_ownership_geom_gist on public.land_ownership using gist (geom);
create index if not exists land_ownership_type_idx  on public.land_ownership (ownership_type);

-- Public reference data: world-readable, no client writes (import runs as service role / direct conn).
alter table public.land_ownership enable row level security;

drop policy if exists "land_ownership readable" on public.land_ownership;
create policy "land_ownership readable"
  on public.land_ownership
  for select
  to anon, authenticated
  using (true);
