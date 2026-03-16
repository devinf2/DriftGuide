-- Community Locations: user-submitted fishing spots with spatial deduplication

-- Trigram matching for fuzzy name search
create extension if not exists pg_trgm;

-- Provenance columns
alter table locations add column if not exists created_by uuid references profiles(id);
alter table locations add column if not exists status text default 'verified'
  check (status in ('verified', 'community', 'pending'));
alter table locations add column if not exists usage_count integer default 0;

-- Indexes for proximity + fuzzy queries
create index if not exists idx_locations_name_trgm on locations using gin(name gin_trgm_ops);
create index if not exists idx_locations_lat on locations(latitude);
create index if not exists idx_locations_lng on locations(longitude);
create index if not exists idx_locations_status on locations(status);

-- Let authenticated users update locations they created
create policy "Users can update locations they created"
  on locations for update using (auth.uid() = created_by);

-- RPC: find locations near a coordinate, optionally with fuzzy name match.
-- Uses Haversine formula (no PostGIS dependency).
create or replace function search_nearby_locations(
  search_lat double precision,
  search_lng double precision,
  search_name text default '',
  radius_km double precision default 5
)
returns table (
  id uuid,
  name text,
  type location_type,
  latitude double precision,
  longitude double precision,
  status text,
  distance_km double precision,
  name_similarity real
)
language sql stable
as $$
  select
    l.id,
    l.name,
    l.type,
    l.latitude,
    l.longitude,
    l.status,
    (6371 * acos(
      least(1.0,
        cos(radians(search_lat)) * cos(radians(l.latitude))
        * cos(radians(l.longitude) - radians(search_lng))
        + sin(radians(search_lat)) * sin(radians(l.latitude))
      )
    )) as distance_km,
    case
      when search_name = '' then 0.0::real
      else similarity(l.name, search_name)
    end as name_similarity
  from locations l
  where l.latitude is not null
    and l.longitude is not null
    and (
      -- Bounding-box pre-filter for the spatial radius
      (
        l.latitude between search_lat - (radius_km / 111.0)
                       and search_lat + (radius_km / 111.0)
        and l.longitude between search_lng - (radius_km / (111.0 * cos(radians(search_lat))))
                           and search_lng + (radius_km / (111.0 * cos(radians(search_lat))))
      )
      -- OR fuzzy name match regardless of distance
      or (search_name != '' and similarity(l.name, search_name) > 0.3)
    )
  order by distance_km asc nulls last
  limit 10;
$$;

-- RPC: bump usage_count when a trip starts at a location
create or replace function increment_location_usage(loc_id uuid)
returns void language sql as $$
  update locations set usage_count = coalesce(usage_count, 0) + 1 where id = loc_id;
$$;
