-- Soft delete for locations: hidden from lists and search once deleted_at is set.

-- search_nearby_locations uses similarity(); that comes from pg_trgm (see 002). Safe if 002 was skipped.
create extension if not exists pg_trgm;

alter table public.locations
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

comment on column public.locations.deleted_at is 'When set, row is soft-deleted and excluded from normal visibility.';
comment on column public.locations.deleted_by is 'Profile that performed the soft delete (typically created_by).';

create index if not exists idx_locations_deleted_at on public.locations (deleted_at);

-- SELECT: hide soft-deleted rows
drop policy if exists "Locations viewable when public or owned" on public.locations;

create policy "Locations viewable when public or owned"
  on public.locations
  for select
  to authenticated
  using (
    deleted_at is null
    and (coalesce(is_public, true) = true or created_by = auth.uid())
  );

-- INSERT: cannot create an already-deleted row
drop policy if exists "Locations can be inserted by authenticated users" on public.locations;

create policy "Locations can be inserted by authenticated users"
  on public.locations
  for insert
  to authenticated
  with check (
    auth.role() = 'authenticated'
    and deleted_at is null
  );

-- UPDATE: only active rows; creator may update (including soft-delete)
drop policy if exists "Users can update locations they created" on public.locations;

create policy "Users can update locations they created"
  on public.locations
  for update
  to authenticated
  using (auth.uid() = created_by and deleted_at is null)
  with check (auth.uid() = created_by);

-- Proximity search: exclude soft-deleted
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
    and l.deleted_at is null
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

-- Parent-candidate search: exclude soft-deleted
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
      and l.deleted_at is null
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

-- Do not bump usage on deleted rows
create or replace function increment_location_usage(loc_id uuid)
returns void language sql as $$
  update locations
  set usage_count = coalesce(usage_count, 0) + 1
  where id = loc_id
    and deleted_at is null;
$$;
