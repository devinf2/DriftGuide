-- Nearby top-level locations (no parent) for linking a newly created spot as a sub-location.

create or replace function search_nearby_root_locations(
  search_lat double precision,
  search_lng double precision,
  exclude_location_id uuid,
  radius_km double precision default 75
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
  with scored as (
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
      )) as distance_km
    from locations l
    where l.latitude is not null
      and l.longitude is not null
      and l.parent_location_id is null
      and l.id <> exclude_location_id
  )
  select
    s.id,
    s.name,
    s.type,
    s.latitude,
    s.longitude,
    s.status,
    s.distance_km,
    0.0::real as name_similarity
  from scored s
  where s.distance_km <= radius_km
  order by s.distance_km asc nulls last
  limit 3;
$$;
