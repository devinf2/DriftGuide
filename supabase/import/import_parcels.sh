#!/usr/bin/env bash
#
# PHASE 2 — Import Utah statewide parcel boundaries (UGRC LIR Parcels) into PostGIS.
# Present for completeness; NOT part of the initial rollout. Parcels are large
# (~1M+ polygons) — run against a branch DB first and watch storage.
#
# Prereqs: same as import_land_ownership.sh (GDAL/ogr2ogr, psql, DATABASE_URL = direct conn).
# Data: https://gis.utah.gov/products/sgid/cadastre/parcels/  (statewide LIR Parcels GDB/shp)
#
# Usage:
#   DATABASE_URL=postgres://... ./import_parcels.sh /path/to/Parcels_Statewide.shp
#
# Attribute names vary by county/vintage. Adjust the SELECT mapping below to match
# `\d land_parcels_raw` after the load (parcel_id / owner / county / address fields).

set -euo pipefail
SHAPEFILE="${1:?Usage: import_parcels.sh <path-to-parcels.shp>}"
: "${DATABASE_URL:?Set DATABASE_URL to the Supabase direct connection string}"

echo "==> [1/3] Loading parcels into land_parcels_raw…"
ogr2ogr \
  -f PostgreSQL "PG:$DATABASE_URL" \
  "$SHAPEFILE" \
  -nln land_parcels_raw \
  -t_srs EPSG:4326 \
  -nlt PROMOTE_TO_MULTI \
  -lco GEOMETRY_NAME=geom \
  -lco FID=raw_fid \
  -overwrite \
  --config PG_USE_COPY YES

echo "==> [2/3] Normalizing into public.land_parcels…"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
truncate public.land_parcels;
insert into public.land_parcels (parcel_id, county, owner_name, address, geom)
select
  nullif(coalesce(raw.parcel_id, raw.parcelid, raw.apn), '')   as parcel_id,
  nullif(raw.county, '')                                       as county,
  nullif(coalesce(raw.owner_name, raw.owner), '')              as owner_name,
  nullif(coalesce(raw.prop_addr, raw.address), '')             as address,
  ST_Multi(ST_CollectionExtract(ST_MakeValid(raw.geom), 3))::geometry(MultiPolygon, 4326)
from public.land_parcels_raw raw
where raw.geom is not null
  and not ST_IsEmpty(ST_MakeValid(raw.geom));
commit;
SQL

echo "==> [3/3] Cleanup + ANALYZE…"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "drop table if exists public.land_parcels_raw; analyze public.land_parcels;"
psql "$DATABASE_URL" -c "select count(*) as parcels from public.land_parcels;"
