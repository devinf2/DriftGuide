-- Phase 2 scaffold: statewide parcel boundaries (source: Utah UGRC LIR Parcels).
-- Schema + tile function + GiST index land NOW so the app's z16+ render path and the
-- import script have a stable target. No parcel data is imported in this phase.
--
-- Also stubs future `easements` and `fishing_access_points` so the overlay enum and the
-- ST_AsMVT tile pattern already have a home. These tables are intentionally empty and
-- have no UI wired yet.

-- ── Parcels ─────────────────────────────────────────────────────────────────────────
create table if not exists public.land_parcels (
  id          bigint generated always as identity primary key,
  parcel_id   text,            -- county APN / parcel number
  county      text,
  owner_name  text,
  address     text,
  geom        geometry(MultiPolygon, 4326) not null
);

create index if not exists land_parcels_geom_gist on public.land_parcels using gist (geom);
create index if not exists land_parcels_county_idx on public.land_parcels (county);

alter table public.land_parcels enable row level security;
drop policy if exists "land_parcels readable" on public.land_parcels;
create policy "land_parcels readable"
  on public.land_parcels for select to anon, authenticated using (true);

-- Tile function. Parcels are only meaningful at high zoom, so emit nothing below z16 —
-- this guarantees the "parcels only at zoom 16+" rule even if a client misconfigures the source.
create or replace function public.land_parcels_mvt(
  z integer,
  x integer,
  y integer
)
returns bytea
language plpgsql
stable
parallel safe
as $$
declare
  tile_3857 geometry;
  tile_4326 geometry;
  result bytea;
begin
  if z < 16 then
    return ''::bytea;
  end if;

  tile_3857 := ST_TileEnvelope(z, x, y);
  tile_4326 := ST_Transform(tile_3857, 4326);

  with mvtgeom as (
    select
      ST_AsMVTGeom(ST_Transform(p.geom, 3857), tile_3857) as geom,
      p.parcel_id,
      p.owner_name,
      p.county
    from public.land_parcels p
    where p.geom && tile_4326
      and ST_Intersects(p.geom, tile_4326)
  )
  select ST_AsMVT(mvtgeom.*, 'land_parcels', 4096, 'geom')
  into result
  from mvtgeom
  where geom is not null;

  return coalesce(result, ''::bytea);
end;
$$;

grant execute on function public.land_parcels_mvt(integer, integer, integer)
  to anon, authenticated, service_role;

-- ── Future overlays (stubs, no data, no UI) ──────────────────────────────────────────
-- Easements: linear/polygon access corridors (e.g. recorded public access easements).
create table if not exists public.easements (
  id            bigint generated always as identity primary key,
  name          text,
  easement_type text,            -- 'public_access' | 'utility' | 'conservation' | ...
  grantor       text,
  notes         text,
  geom          geometry(Geometry, 4326) not null
);
create index if not exists easements_geom_gist on public.easements using gist (geom);
alter table public.easements enable row level security;
drop policy if exists "easements readable" on public.easements;
create policy "easements readable"
  on public.easements for select to anon, authenticated using (true);

-- Fishing access points: published put-in / bank-access / boat-ramp points.
create table if not exists public.fishing_access_points (
  id            bigint generated always as identity primary key,
  name          text,
  access_type   text,            -- 'boat_ramp' | 'bank' | 'walk_in' | 'parking' | ...
  managing_body text,
  notes         text,
  geom          geometry(Point, 4326) not null
);
create index if not exists fishing_access_points_geom_gist
  on public.fishing_access_points using gist (geom);
alter table public.fishing_access_points enable row level security;
drop policy if exists "fishing_access_points readable" on public.fishing_access_points;
create policy "fishing_access_points readable"
  on public.fishing_access_points for select to anon, authenticated using (true);
