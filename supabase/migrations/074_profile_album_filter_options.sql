-- Distinct location / fly / species options for profile album filters (full history, not paginated).

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
