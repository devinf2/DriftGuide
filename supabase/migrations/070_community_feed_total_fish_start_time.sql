-- Add total_fish + start_time to community feed payload (profile photo remains profiles.avatar_url).
-- After apply: notify pgrst, 'reload schema';

drop function if exists public.list_public_location_trip_ratings(uuid, integer);

create or replace function public.list_public_location_trip_ratings(p_location_id uuid, p_limit integer default 100)
returns table (
  trip_id uuid,
  rated_at timestamptz,
  start_time timestamptz,
  total_fish integer,
  rating smallint,
  notes text,
  user_reported_clarity text,
  display_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    coalesce(t.end_time, t.start_time),
    t.start_time,
    t.total_fish,
    t.rating,
    t.notes,
    t.user_reported_clarity::text,
    coalesce(nullif(trim(pr.display_name), ''), 'Angler'),
    pr.avatar_url
  from public.trips t
  inner join public.profiles pr on pr.id = t.user_id
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

create or replace function public.location_community_ratings_feed(p_location_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lim int := least(greatest(coalesce(p_limit, 100), 1), 200);
  recent_30d int;
  items jsonb;
begin
  select count(*)::int into recent_30d
  from public.trips t
  inner join public.profiles pr on pr.id = t.user_id
  where t.deleted_at is null
    and pr.account_deleted_at is null
    and t.location_id = p_location_id
    and t.status = 'completed'::public.trip_status
    and t.rating is not null
    and public.effective_trip_photo_visibility(t.id) = 'public'::public.trip_photo_visibility
    and coalesce(t.end_time, t.start_time) >= (now() - interval '30 days');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'trip_id', trip_id,
        'rated_at', rated_at,
        'start_time', start_time,
        'total_fish', total_fish,
        'rating', rating,
        'notes', notes,
        'user_reported_clarity', user_reported_clarity,
        'display_name', display_name,
        'avatar_url', avatar_url
      )
      order by rated_at desc nulls last
    ),
    '[]'::jsonb
  )
  into items
  from (
    select
      t.id as trip_id,
      coalesce(t.end_time, t.start_time) as rated_at,
      t.start_time,
      t.total_fish,
      t.rating::int as rating,
      t.notes,
      t.user_reported_clarity::text as user_reported_clarity,
      coalesce(nullif(trim(pr.display_name), ''), 'Angler') as display_name,
      pr.avatar_url
    from public.trips t
    inner join public.profiles pr on pr.id = t.user_id
    where t.deleted_at is null
      and pr.account_deleted_at is null
      and t.location_id = p_location_id
      and t.status = 'completed'::public.trip_status
      and t.rating is not null
      and public.effective_trip_photo_visibility(t.id) = 'public'::public.trip_photo_visibility
    order by coalesce(t.end_time, t.start_time) desc nulls last
    limit lim
  ) sub;

  return jsonb_build_object(
    'recent_30d_count', coalesce(recent_30d, 0),
    'items', coalesce(items, '[]'::jsonb)
  );
end;
$$;
