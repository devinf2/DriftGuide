-- Let accepted friends read each other's fly box and completed-trip aggregates (stats),
-- without exposing active/planned trips or non-friend data.

create or replace function public.accepted_friends(profile_a uuid, profile_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships f
    where f.profile_min = least(profile_a, profile_b)
      and f.profile_max = greatest(profile_a, profile_b)
      and f.status = 'accepted'::public.friendship_status
  );
$$;

revoke all on function public.accepted_friends(uuid, uuid) from public;
grant execute on function public.accepted_friends(uuid, uuid) to authenticated;

create policy "Accepted friends can view peer user_fly_box"
  on public.user_fly_box for select
  to authenticated
  using (
    auth.uid() is not null
    and user_id is distinct from auth.uid()
    and public.accepted_friends(user_id, auth.uid())
  );

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
      )
    )
  );
