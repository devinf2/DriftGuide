-- Read APIs over public.land_ownership:
--   1) land_ownership_at_point  — tap-to-inspect (ST_Contains), called from the app via supabase.rpc
--   2) land_ownership_mvt       — Mapbox Vector Tiles (ST_AsMVT), served by the land-tiles edge fn
-- Both are STABLE + PARALLEL SAFE and lean on the GiST index from migration 110.

-- 1) Point lookup. Returns the smallest enclosing polygon so a parcel-sized inholding
--    wins over a surrounding federal unit on overlap.
create or replace function public.land_ownership_at_point(
  lng double precision,
  lat double precision
)
returns table (
  ownership_type text,
  agency text,
  owner_name text,
  access_status text,
  admin_unit text
)
language sql
stable
parallel safe
as $$
  select
    lo.ownership_type,
    lo.agency,
    lo.owner_name,
    lo.access_status,
    lo.admin_unit
  from public.land_ownership lo
  where ST_Contains(lo.geom, ST_SetSRID(ST_MakePoint(lng, lat), 4326))
  order by ST_Area(lo.geom) asc
  limit 1;
$$;

-- 2) Vector tile. Standard ST_TileEnvelope → ST_AsMVTGeom pipeline; geometry is stored in
--    EPSG:4326 and transformed to 3857 (Web Mercator) for tiling. The tile envelope is
--    transformed back to 4326 for the index-backed ST_Intersects filter.
create or replace function public.land_ownership_mvt(
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
  tile_3857 geometry := ST_TileEnvelope(z, x, y);
  tile_4326 geometry := ST_Transform(tile_3857, 4326);
  result bytea;
begin
  with mvtgeom as (
    select
      ST_AsMVTGeom(ST_Transform(lo.geom, 3857), tile_3857) as geom,
      lo.ownership_type,
      lo.agency,
      lo.access_status
    from public.land_ownership lo
    where lo.geom && tile_4326
      and ST_Intersects(lo.geom, tile_4326)
  )
  select ST_AsMVT(mvtgeom.*, 'land_ownership', 4096, 'geom')
  into result
  from mvtgeom
  where geom is not null;

  return coalesce(result, ''::bytea);
end;
$$;

grant execute on function public.land_ownership_at_point(double precision, double precision)
  to anon, authenticated;
grant execute on function public.land_ownership_mvt(integer, integer, integer)
  to anon, authenticated, service_role;
