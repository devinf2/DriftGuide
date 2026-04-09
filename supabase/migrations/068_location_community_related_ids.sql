-- Community ratings: match trips on this location OR any ancestor/descendant in the catalog tree
-- (e.g. trip logged on "Utah Lake" shows when viewing child "Provo Bay - Utah Lake").
-- After apply in SQL Editor, run:  notify pgrst, 'reload schema';

create or replace function public.location_related_ids(p_root uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select array_agg(x.id)::uuid[]
      from (
        with recursive ancestors as (
          select loc.id, loc.parent_location_id
          from public.locations loc
          where loc.id = p_root
          union all
          select l.id, l.parent_location_id
          from public.locations l
          inner join ancestors a on l.id = a.parent_location_id
        ),
        descendants as (
          select loc.id
          from public.locations loc
          where loc.id = p_root
          union all
          select l.id
          from public.locations l
          inner join descendants d on l.parent_location_id = d.id
        )
        select id from ancestors
        union
        select id from descendants
      ) x
    ),
    array[p_root]::uuid[]
  );
$$;

revoke all on function public.location_related_ids(uuid) from public;
grant execute on function public.location_related_ids(uuid) to authenticated;

comment on function public.location_related_ids(uuid) is
  'Ancestor chain + descendant subtree of a catalog location; falls back to {p_root} if no row in locations.';

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
    and t.location_id = any (public.location_related_ids(p_location_id))
    and t.status = 'completed'::public.trip_status
    and t.rating is not null
    and public.effective_trip_photo_visibility(t.id) = 'public'::public.trip_photo_visibility
    and coalesce(t.end_time, t.start_time) >= (now() - interval '30 days');
$$;

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
    and t.location_id = any (public.location_related_ids(p_location_id))
    and t.status = 'completed'::public.trip_status
    and t.rating is not null
    and public.effective_trip_photo_visibility(t.id) = 'public'::public.trip_photo_visibility
  order by coalesce(t.end_time, t.start_time) desc nulls last
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

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
  loc_ids uuid[];
begin
  loc_ids := public.location_related_ids(p_location_id);

  select count(*)::int into recent_30d
  from public.trips t
  inner join public.profiles pr on pr.id = t.user_id
  where t.deleted_at is null
    and pr.account_deleted_at is null
    and t.location_id = any (loc_ids)
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
      where p.trip_id = t.id
        and p.deleted_at is null
      order by p.created_at asc nulls last, p.id asc
      limit 1
    ) ph on true
    where t.deleted_at is null
      and pr.account_deleted_at is null
      and t.location_id = any (loc_ids)
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
