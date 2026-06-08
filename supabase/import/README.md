# Utah Land Ownership / Parcel Import

Loads Utah UGRC spatial data into the app's PostGIS tables. Run **after** migrations
`109`–`112` have been applied (the destination tables + functions must exist).

## Prerequisites

- **GDAL / ogr2ogr** and **psql**
  - macOS: `brew install gdal libpq` (then add libpq to PATH, e.g. `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`)
- **Direct** Supabase connection string (not the pooler):
  Supabase Dashboard → Project Settings → Database → Connection string → **URI**.
  ```
  export DATABASE_URL='postgres://postgres:[PASSWORD]@db.<project-ref>.supabase.co:5432/postgres'
  ```
  The transaction pooler (`:6543`) does not support the COPY / DDL ogr2ogr needs — use the direct `:5432` host.

## Data sources (Utah Geospatial Resource Center)

| Layer | URL |
|-------|-----|
| Land Ownership (phase 1) | https://gis.utah.gov/products/sgid/cadastre/land-ownership/ |
| LIR Parcels (phase 2) | https://gis.utah.gov/products/sgid/cadastre/parcels/ |

Download the shapefile (or File Geodatabase — ogr2ogr reads `.gdb` too) and unzip.

## Run order

```bash
# 1. Land ownership (the core public/private overlay)
DATABASE_URL=postgres://... ./import_land_ownership.sh /path/to/Utah_Land_Ownership.shp

# 2. (Phase 2, optional) statewide parcels — large, run against a branch DB first
DATABASE_URL=postgres://... ./import_parcels.sh /path/to/Parcels_Statewide.shp
```

Each script: loads a raw staging table via ogr2ogr → normalizes into the app table
(`normalize_land_ownership.sql` buckets owner codes into `ownership_type` / `agency` /
`access_status`) → drops the staging table → `ANALYZE`.

## Notes

- **Attribute names vary by vintage.** ogr2ogr lowercases columns. If normalization errors
  on a missing column, run `psql "$DATABASE_URL" -c '\d land_ownership_raw'` and adjust the
  column references in `normalize_land_ownership.sql` (or the inline SQL in `import_parcels.sh`).
- **Validate small first.** Clip the shapefile to one county (`ogr2ogr -clipsrc ...`) or use a
  Supabase branch database before a full statewide load.
- **Geometry is stored in EPSG:4326**; the MVT functions transform to 3857 at tile time.
  `ST_MakeValid` + `ST_CollectionExtract(...,3)` drop slivers and force MultiPolygon.
- **Re-running is safe** — normalization truncates the destination table first.
