-- Single RPC for the Community tab (one PostgREST call; avoids stale schema / multi-RPC edge cases).
-- After applying: notify pgrst, 'reload schema';

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
        'rating', rating,
        'notes', notes,
        'display_name', display_name,
        'avatar_url', avatar_url,
        'photo_url', photo_url
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
      t.rating::int as rating,
      t.notes,
      coalesce(nullif(trim(pr.display_name), ''), 'Angler') as display_name,
      pr.avatar_url,
      ph.url as photo_url
    from public.trips t
    inner join public.profiles pr on pr.id = t.user_id
    left join lateral (
      select p.url
      from public.photos p
      where p.trip_id = t.id and p.deleted_at is null
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
    limit lim
  ) sub;

  return jsonb_build_object(
    'recent_30d_count', coalesce(recent_30d, 0),
    'items', coalesce(items, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.location_community_ratings_feed(uuid, integer) from public;
grant execute on function public.location_community_ratings_feed(uuid, integer) to authenticated;

comment on function public.location_community_ratings_feed(uuid, integer) is
  'Community tab payload: recent_30d_count for tab visibility; items = public trip ratings (newest first).';
