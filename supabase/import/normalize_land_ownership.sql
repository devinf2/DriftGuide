-- Normalize the raw UGRC Land Ownership import (land_ownership_raw, loaded by ogr2ogr)
-- into the app-facing public.land_ownership table.
--
-- UGRC's Land Ownership layer carries an `owner` code and an `admin` code. The exact
-- attribute names depend on the shapefile vintage; ogr2ogr lowercases them. If your
-- columns differ, adjust the column references below (see: \d land_ownership_raw).
--
-- Common UGRC `owner` codes: Private, BLM, USFS, NPS, FWS, BOR, DOD/Military, DOE,
--   State Trust Lands (SITLA), State Parks, State Wildlife Reserve/WMA, State Sovereign
--   Land, Tribal, Private-Conservation, Private-Agricultural, County, City, etc.
--
-- Run inside the import script after the raw load. Idempotent: truncates first.

begin;

truncate public.land_ownership;

insert into public.land_ownership (ownership_type, agency, owner_name, admin_unit, access_status, geom)
select
  -- ownership_type bucket ----------------------------------------------------------
  -- UGRC `owner` is coarse: Federal / State / Private (incl. county/city) / Tribal.
  case
    when raw.owner ilike 'private%'  then 'private'
    when raw.owner ~* 'federal'      then 'federal'
    when raw.owner ~* 'tribal'       then 'tribal'
    when raw.owner ~* 'state'        then 'state'
    else 'unknown'
  end as ownership_type,

  -- agency (human label) — derived from the UGRC `admin` code, which carries the
  -- managing agency (BLM, USFS, SITLA, …). `owner` does NOT carry agency detail.
  case upper(nullif(trim(raw.admin), ''))
    when 'BLM'   then 'Bureau of Land Management'
    when 'USFS'  then 'US Forest Service'
    when 'NPS'   then 'National Park Service'
    when 'USFWS' then 'US Fish & Wildlife Service'
    when 'FWS'   then 'US Fish & Wildlife Service'
    when 'BR'    then 'Bureau of Reclamation'
    when 'DOD'   then 'US Department of Defense'
    when 'DOE'   then 'US Department of Energy'
    when 'OF'    then 'Other Federal Land'
    when 'SITLA' then 'SITLA (School & Institutional Trust Lands)'
    when 'UDWR'  then 'Utah Division of Wildlife Resources'
    when 'USP'   then 'Utah State Parks'
    when 'FFSL'  then 'Utah Forestry, Fire & State Lands (Sovereign)'
    when 'UDOT'  then 'Utah Department of Transportation'
    when 'DNR'   then 'Utah Department of Natural Resources'
    when 'OS'    then 'Other State Agency'
    when 'PRIVATE' then null
    when 'TRIBAL'  then null
    else nullif(trim(raw.admin), '')
  end as agency,

  nullif(trim(raw.owner), '')  as owner_name,
  nullif(trim(raw.admin), '')  as admin_unit,

  -- access_status — recreation/fishing access, keyed off owner + admin code.
  -- Federal is public EXCEPT military (DOD) and energy (DOE). State is public
  -- EXCEPT SITLA trust lands (permit nuance surfaced in the sheet copy).
  case
    when raw.owner ilike 'private%'  then 'restricted'
    when raw.owner ~* 'tribal'       then 'restricted'
    when raw.owner ~* 'federal' then
      case when raw.admin ~* '(dod|defense|military|doe|energy)' then 'restricted' else 'public' end
    when raw.owner ~* 'state' then
      case when raw.admin ~* '(sitla|trust)' then 'restricted' else 'public' end
    else 'unknown'
  end as access_status,

  -- geometry: ensure MultiPolygon + validity -------------------------------------
  ST_Multi(ST_CollectionExtract(ST_MakeValid(raw.geom), 3))::geometry(MultiPolygon, 4326) as geom
from public.land_ownership_raw raw
where raw.geom is not null
  and not ST_IsEmpty(ST_MakeValid(raw.geom));

commit;
