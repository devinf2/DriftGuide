-- Enable PostGIS for the Utah land ownership / parcel system.
-- Supabase keeps extensions in the dedicated `extensions` schema (kept off `public`).
-- Geometry/geography types and ST_* functions become available search-path-wide.

create extension if not exists postgis with schema extensions;
