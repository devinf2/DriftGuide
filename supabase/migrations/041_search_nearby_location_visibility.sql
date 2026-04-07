-- Proximity RPCs must not return private rows owned by other users (parity with locations RLS).

create or replace function public.search_nearby_locations(
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
    and l.deleted_at is null
    and (coalesce(l.is_public, true) = true or l.created_by = auth.uid())
    and (
      (
        l.latitude between search_lat - (radius_km / 111.0)
                       and search_lat + (radius_km / 111.0)
        and l.longitude between search_lng - (radius_km / (111.0 * cos(radians(search_lat))))
                           and search_lng + (radius_km / (111.0 * cos(radians(search_lat))))
      )
      or (search_name != '' and similarity(l.name, search_name) > 0.3)
    )
  order by distance_km asc nulls last
  limit 10;
$$;

grant execute on function public.search_nearby_locations(
  double precision,
  double precision,
  text,
  double precision
) to authenticated;

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
      and (coalesce(l.is_public, true) = true or l.created_by = auth.uid())
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
