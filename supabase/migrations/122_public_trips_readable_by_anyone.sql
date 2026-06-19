-- Trip visibility for reads of OTHER users' completed trips (profile album, feed, friend
-- stats), keyed off effective_trip_photo_visibility (migration 053):
--   * non-friend  -> 'public' only
--   * accepted friend -> 'public' + 'friends_only'
--   * 'private' -> owner (and session peers) only, never exposed to others
--
-- This narrows the friend rule from migration 052 (which let friends read ALL completed
-- trips regardless of visibility) so private trips no longer leak to friends via the album
-- or the friend stats aggregates that build on user_can_read_trip.

create or replace function public.user_can_read_trip(p_trip_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and t.deleted_at is null
      and t.user_id = p_user_id
  )
  or public.user_can_read_trip_via_session(p_trip_id, p_user_id)
  or exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and t.deleted_at is null
      and t.user_id is distinct from p_user_id
      and t.status = 'completed'::public.trip_status
      and public.accepted_friends(t.user_id, p_user_id)
      and public.effective_trip_photo_visibility(t.id) = 'friends_only'::public.trip_photo_visibility
  )
  or exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and t.deleted_at is null
      and t.user_id is distinct from p_user_id
      and t.status = 'completed'::public.trip_status
      and public.effective_trip_photo_visibility(t.id) = 'public'::public.trip_photo_visibility
  );
$$;

drop policy if exists "Users can view own trips" on public.trips;

create policy "Users can view own trips"
  on public.trips for select
  using (
    deleted_at is null
    and (
      auth.uid() = user_id
      or public.user_can_read_trip_via_session(id, auth.uid())
      or (
        user_id is distinct from auth.uid()
        and status = 'completed'::public.trip_status
        and public.accepted_friends(user_id, auth.uid())
        and public.effective_trip_photo_visibility(id) = 'friends_only'::public.trip_photo_visibility
      )
      or (
        user_id is distinct from auth.uid()
        and status = 'completed'::public.trip_status
        and public.effective_trip_photo_visibility(id) = 'public'::public.trip_photo_visibility
      )
    )
  );
