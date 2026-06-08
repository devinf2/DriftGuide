#!/usr/bin/env bash
#
# Import the Utah UGRC Land Ownership shapefile into PostGIS.
#
#   1. ogr2ogr loads the shapefile into a raw staging table (land_ownership_raw)
#   2. normalize_land_ownership.sql buckets it into public.land_ownership
#   3. ANALYZE so the planner uses the GiST index
#
# Prereqs:
#   - GDAL/ogr2ogr + psql on PATH  (macOS: `brew install gdal libpq`)
#   - DATABASE_URL = Supabase *direct* connection string
#       Project Settings → Database → Connection string → URI (NOT the pooler / :6543).
#       e.g. postgres://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres
#   - Land Ownership shapefile from https://gis.utah.gov/products/sgid/cadastre/land-ownership/
#
# Usage:
#   DATABASE_URL=postgres://... ./import_land_ownership.sh /path/to/Utah_Land_Ownership.shp
#
# Tip: validate on one county first by clipping the shapefile, or run against a branch DB.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHAPEFILE="${1:?Usage: import_land_ownership.sh <path-to-shapefile.shp>}"

: "${DATABASE_URL:?Set DATABASE_URL to the Supabase direct connection string}"

if [[ ! -f "$SHAPEFILE" ]]; then
  echo "Shapefile not found: $SHAPEFILE" >&2
  exit 1
fi

echo "==> [1/3] Loading $SHAPEFILE into land_ownership_raw (EPSG:4326)…"
ogr2ogr \
  -f PostgreSQL "PG:$DATABASE_URL" \
  "$SHAPEFILE" \
  -nln land_ownership_raw \
  -t_srs EPSG:4326 \
  -nlt PROMOTE_TO_MULTI \
  -lco GEOMETRY_NAME=geom \
  -lco FID=raw_fid \
  -lco PRECISION=NO \
  -overwrite \
  --config PG_USE_COPY YES

echo "==> [2/3] Normalizing into public.land_ownership…"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/normalize_land_ownership.sql"

echo "==> [3/3] Cleaning up staging + ANALYZE…"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "drop table if exists public.land_ownership_raw; analyze public.land_ownership;"

echo "==> Done. Row counts by ownership_type:"
psql "$DATABASE_URL" -c "select ownership_type, count(*) from public.land_ownership group by 1 order by 2 desc;"
