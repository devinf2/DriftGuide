-- Friend profile: allow reading catches on any trip the viewer may read (owner, session peer, accepted friend on completed trips).
-- Standalone album photos (trip_id is null): allow accepted friends to read each other's home-album rows.
-- Keep profile_album_* RPCs aligned with RLS.

-- ---------------------------------------------------------------------------
-- catches: align SELECT with public.user_can_read_trip (includes friend reads)
-- ---------------------------------------------------------------------------
drop policy if exists "Users can view own catches" on public.catches;

create policy "Users can view own catches"
  on public.catches for select
  using (
    deleted_at is null
    and public.user_can_read_trip(trip_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- photos: peer home album (no trip) visible to accepted friends
-- ---------------------------------------------------------------------------
drop policy if exists "Peer standalone album photos for accepted friends" on public.photos;

create policy "Peer standalone album photos for accepted friends"
  on public.photos for select
  to authenticated
  using (
    deleted_at is null
    and trip_id is null
    and auth.uid() is not null
    and auth.uid() is distinct from user_id
    and public.accepted_friends(user_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- profile_album_photos_page: include standalone rows for accepted friends
-- ---------------------------------------------------------------------------
create or replace function public.profile_album_photos_page(
  p_album_user_id uuid,
  p_limit integer,
  p_offset integer,
  p_location_ids uuid[] default null,
  p_date_from date default null,
  p_date_to date default null,
  p_species text[] default null,
  p_fly_patterns text[] default null
)
returns setof public.photos
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.photos p
  left join public.trips tr
    on tr.id = p.trip_id
    and tr.deleted_at is null
  where
    auth.uid() is not null
    and p.user_id = p_album_user_id
    and p.deleted_at is null
    and (
      auth.uid() = p.user_id
      or (
        p.trip_id is null
        and auth.uid() is distinct from p.user_id
        and public.accepted_friends(p.user_id, auth.uid())
      )
      or (
        p.trip_id is not null
        and public.user_can_read_trip_via_session(p.trip_id, auth.uid())
      )
      or (
        p.trip_id is not null
        and (
          public.effective_trip_photo_visibility(p.trip_id) = 'public'::public.trip_photo_visibility
          or (
            public.effective_trip_photo_visibility(p.trip_id) = 'friends_only'::public.trip_photo_visibility
            and public.accepted_friends(p_album_user_id, auth.uid())
          )
        )
      )
    )
    and (
      p_location_ids is null
      or cardinality(p_location_ids) = 0
      or (
        p.trip_id is not null
        and tr.location_id is not null
        and tr.location_id = any (p_location_ids)
      )
    )
    and (
      p_date_from is null
      or (
        coalesce(p.captured_at, p.created_at) is not null
        and (coalesce(p.captured_at, p.created_at))::date >= p_date_from
      )
    )
    and (
      p_date_to is null
      or (
        coalesce(p.captured_at, p.created_at) is not null
        and (coalesce(p.captured_at, p.created_at))::date <= p_date_to
      )
    )
    and (
      p_species is null
      or cardinality(p_species) = 0
      or (
        p.species is not null
        and trim(p.species) in (select trim(s) from unnest(p_species) as s)
      )
    )
    and (
      p_fly_patterns is null
      or cardinality(p_fly_patterns) = 0
      or (
        p.fly_pattern is not null
        and trim(p.fly_pattern) in (select trim(f) from unnest(p_fly_patterns) as f)
      )
    )
  order by coalesce(p.captured_at, p.created_at) desc nulls last, p.id desc
  limit greatest(coalesce(p_limit, 0), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.profile_album_photos_page(
  uuid, integer, integer, uuid[], date, date, text[], text[]
) from public;

grant execute on function public.profile_album_photos_page(
  uuid, integer, integer, uuid[], date, date, text[], text[]
) to authenticated;

-- ---------------------------------------------------------------------------
-- profile_album_filter_options: photo_visible CTE includes standalone friends
-- ---------------------------------------------------------------------------
create or replace function public.profile_album_filter_options(p_album_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with readable_completed_trips as (
    select t.id, t.location_id
    from public.trips t
    where
      auth.uid() is not null
      and t.user_id = p_album_user_id
      and t.deleted_at is null
      and t.status = 'completed'::public.trip_status
      and public.user_can_read_trip(t.id, auth.uid())
  ),
  photo_visible as (
    select p.*
    from public.photos p
    where
      p.user_id = p_album_user_id
      and p.deleted_at is null
      and (
        auth.uid() = p.user_id
        or (
          p.trip_id is null
          and auth.uid() is distinct from p.user_id
          and public.accepted_friends(p.user_id, auth.uid())
        )
        or (
          p.trip_id is not null
          and public.user_can_read_trip_via_session(p.trip_id, auth.uid())
        )
        or (
          p.trip_id is not null
          and (
            public.effective_trip_photo_visibility(p.trip_id) = 'public'::public.trip_photo_visibility
            or (
              public.effective_trip_photo_visibility(p.trip_id) = 'friends_only'::public.trip_photo_visibility
              and public.accepted_friends(p_album_user_id, auth.uid())
            )
          )
        )
      )
  ),
  locs as (
    select distinct l.id, l.name
    from (
      select rt.location_id as lid
      from readable_completed_trips rt
      where rt.location_id is not null
      union
      select tr.location_id as lid
      from photo_visible pv
      inner join public.trips tr on tr.id = pv.trip_id and tr.deleted_at is null
      where pv.trip_id is not null and tr.location_id is not null
    ) z
    inner join public.locations l on l.id = z.lid and l.deleted_at is null
  ),
  catch_fly as (
    select distinct trim(c.fly_pattern) as v
    from public.catches c
    inner join readable_completed_trips rt on rt.id = c.trip_id
    where
      c.user_id = p_album_user_id
      and c.deleted_at is null
      and c.fly_pattern is not null
      and trim(c.fly_pattern) <> ''
  ),
  catch_sp as (
    select distinct trim(c.species) as v
    from public.catches c
    inner join readable_completed_trips rt on rt.id = c.trip_id
    where
      c.user_id = p_album_user_id
      and c.deleted_at is null
      and c.species is not null
      and trim(c.species) <> ''
  ),
  photo_fly as (
    select distinct trim(p.fly_pattern) as v
    from photo_visible p
    where p.fly_pattern is not null and trim(p.fly_pattern) <> ''
  ),
  photo_sp as (
    select distinct trim(p.species) as v
    from photo_visible p
    where p.species is not null and trim(p.species) <> ''
  ),
  flies as (
    select v from catch_fly
    union
    select v from photo_fly
  ),
  species as (
    select v from catch_sp
    union
    select v from photo_sp
  )
  select jsonb_build_object(
    'locations',
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.name)
        from locs l
      ),
      '[]'::jsonb
    ),
    'fly_patterns',
    coalesce(
      (
        select to_jsonb(coalesce(array_agg(f.v order by f.v), array[]::text[]))
        from flies f
      ),
      '[]'::jsonb
    ),
    'species',
    coalesce(
      (
        select to_jsonb(coalesce(array_agg(s.v order by s.v), array[]::text[]))
        from species s
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.profile_album_filter_options(uuid) from public;
grant execute on function public.profile_album_filter_options(uuid) to authenticated;
