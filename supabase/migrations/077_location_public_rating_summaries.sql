-- Batch: average public trip rating (1–5) per catalog location for home cards.
-- Same filters as location_community_ratings_feed list (exact location_id, completed, public visibility).
-- After apply: notify pgrst, 'reload schema';

create or replace function public.location_public_rating_summaries(p_location_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with per_loc as (
    select
      t.location_id,
      round(avg(t.rating::numeric), 2) as rating_avg,
      count(*)::int as rating_count
    from public.trips t
    inner join public.profiles pr on pr.id = t.user_id
    where t.deleted_at is null
      and pr.account_deleted_at is null
      and t.location_id = any(coalesce(p_location_ids, array[]::uuid[]))
      and t.status = 'completed'::public.trip_status
      and t.rating is not null
      and public.effective_trip_photo_visibility(t.id) = 'public'::public.trip_photo_visibility
    group by t.location_id
  )
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'location_id', location_id,
          'rating_avg', rating_avg,
          'rating_count', rating_count
        )
      )
      from per_loc
    ),
    '[]'::jsonb
  );
$$;

revoke all on function public.location_public_rating_summaries(uuid[]) from public;
grant execute on function public.location_public_rating_summaries(uuid[]) to authenticated;

comment on function public.location_public_rating_summaries(uuid[]) is
  'Per-location average rating + count for public completed trips with non-null rating; used by home spot cards.';
