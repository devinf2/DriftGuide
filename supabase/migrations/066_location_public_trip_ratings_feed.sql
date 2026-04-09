-- Public trip ratings on a location (Community tab): readable by any signed-in user when
-- the trip owner set effective trip photo visibility to public. Bypasses trips RLS via SECURITY DEFINER.
--
-- If you paste this into the Supabase SQL Editor, run afterward so the API picks up the new RPCs:
--   notify pgrst, 'reload schema';

create or replace function public.count_public_location_ratings_30d(p_location_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.trips t
  inner join public.profiles pr on pr.id = t.user_id
  where t.deleted_at is null
    and pr.account_deleted_at is null
    and t.location_id = p_location_id
    and t.status = 'completed'::public.trip_status
    and t.rating is not null
    and public.effective_trip_photo_visibility(t.id) = 'public'::public.trip_photo_visibility
    and coalesce(t.end_time, t.start_time) >= (now() - interval '30 days');
$$;

revoke all on function public.count_public_location_ratings_30d(uuid) from public;
grant execute on function public.count_public_location_ratings_30d(uuid) to authenticated;

comment on function public.count_public_location_ratings_30d(uuid) is
  'Number of completed trips with a star rating at this location in the last 30 days, public photo visibility only.';

create or replace function public.list_public_location_trip_ratings(p_location_id uuid, p_limit integer default 100)
returns table (
  trip_id uuid,
  rated_at timestamptz,
  rating smallint,
  notes text,
  display_name text,
  avatar_url text,
  photo_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    coalesce(t.end_time, t.start_time),
    t.rating,
    t.notes,
    coalesce(nullif(trim(pr.display_name), ''), 'Angler'),
    pr.avatar_url,
    ph.url
  from public.trips t
  inner join public.profiles pr on pr.id = t.user_id
  left join lateral (
    select p.url
    from public.photos p
    where p.trip_id = t.id
      and p.deleted_at is null
    order by p.created_at asc nulls last, p.id asc
    limit 1
  ) ph on true
  where t.deleted_at is null
    and pr.account_deleted_at is null
    and t.location_id = p_location_id
    and t.status = 'completed'::public.trip_status
    and t.rating is not null
    and public.effective_trip_photo_visibility(t.id) = 'public'::public.trip_photo_visibility
  order by coalesce(t.end_time, t.start_time) desc nulls last
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

revoke all on function public.list_public_location_trip_ratings(uuid, integer) from public;
grant execute on function public.list_public_location_trip_ratings(uuid, integer) to authenticated;

comment on function public.list_public_location_trip_ratings(uuid, integer) is
  'Completed trips with ratings at this location, public photo visibility only, newest first; optional photo from first album row.';
