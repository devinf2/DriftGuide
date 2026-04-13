-- Server-side filters for profile album pagination (trips + photos).
-- Client previously filtered only loaded pages; these RPCs scan the full album with the same rules.

-- ---------------------------------------------------------------------------
-- Completed trips: location, date (trip.start_time::date), species & fly from catches + photos
-- ---------------------------------------------------------------------------
create or replace function public.profile_album_completed_trips_page(
  p_album_user_id uuid,
  p_limit integer,
  p_offset integer,
  p_location_ids uuid[] default null,
  p_date_from date default null,
  p_date_to date default null,
  p_species text[] default null,
  p_fly_patterns text[] default null
)
returns setof public.trips
language sql
stable
security definer
set search_path = public
as $$
  select t.*
  from public.trips t
  where
    auth.uid() is not null
    and public.user_can_read_trip(t.id, auth.uid())
    and t.user_id = p_album_user_id
    and t.deleted_at is null
    and t.status = 'completed'::public.trip_status
    and (
      p_location_ids is null
      or cardinality(p_location_ids) = 0
      or (
        t.location_id is not null
        and t.location_id = any (p_location_ids)
      )
    )
    and (
      p_date_from is null
      or (t.start_time is not null and (t.start_time)::date >= p_date_from)
    )
    and (
      p_date_to is null
      or (t.start_time is not null and (t.start_time)::date <= p_date_to)
    )
    and (
      (
        (p_species is null or cardinality(p_species) = 0)
        and (p_fly_patterns is null or cardinality(p_fly_patterns) = 0)
      )
      or (
        (
          p_species is null
          or cardinality(p_species) = 0
          or exists (
            select 1
            from public.catches c
            where
              c.trip_id = t.id
              and c.user_id = p_album_user_id
              and c.deleted_at is null
              and c.species is not null
              and trim(c.species) in (select trim(s) from unnest(p_species) as s)
          )
          or exists (
            select 1
            from public.photos ph
            where
              ph.trip_id = t.id
              and ph.user_id = p_album_user_id
              and ph.deleted_at is null
              and ph.species is not null
              and trim(ph.species) in (select trim(s) from unnest(p_species) as s)
          )
        )
        and (
          p_fly_patterns is null
          or cardinality(p_fly_patterns) = 0
          or exists (
            select 1
            from public.catches c2
            where
              c2.trip_id = t.id
              and c2.user_id = p_album_user_id
              and c2.deleted_at is null
              and c2.fly_pattern is not null
              and trim(c2.fly_pattern) in (select trim(f) from unnest(p_fly_patterns) as f)
          )
          or exists (
            select 1
            from public.photos ph2
            where
              ph2.trip_id = t.id
              and ph2.user_id = p_album_user_id
              and ph2.deleted_at is null
              and ph2.fly_pattern is not null
              and trim(ph2.fly_pattern) in (select trim(f) from unnest(p_fly_patterns) as f)
          )
        )
      )
    )
  order by t.start_time desc nulls last, t.id desc
  limit greatest(coalesce(p_limit, 0), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.profile_album_completed_trips_page(
  uuid, integer, integer, uuid[], date, date, text[], text[]
) from public;

grant execute on function public.profile_album_completed_trips_page(
  uuid, integer, integer, uuid[], date, date, text[], text[]
) to authenticated;

-- ---------------------------------------------------------------------------
-- Photos: same visibility as RLS; filters on trip location, photo species/fly, capture date
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
