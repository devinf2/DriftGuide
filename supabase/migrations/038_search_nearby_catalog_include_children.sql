-- Nearest locations by distance for pin / trip flows, including child spots (parent_location_id set).
-- Replaces root-only filter so the closest N are true geographic neighbors, not "roots only".
-- Adds max_results (default 80); callers that need only a short list (e.g. 3) pass it explicitly.

drop function if exists public.search_nearby_root_locations(
  double precision,
  double precision,
  uuid,
  double precision
);

create or replace function public.search_nearby_root_locations(
  search_lat double precision,
  search_lng double precision,
  exclude_location_id uuid default null,
  radius_km double precision default 75,
  max_results integer default 80
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
      and l.deleted_at is null
      and (exclude_location_id is null or l.id <> exclude_location_id)
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
  limit greatest(1, least(max_results, 200));
$$;

grant execute on function public.search_nearby_root_locations(
  double precision,
  double precision,
  uuid,
  double precision,
  integer
) to authenticated;
