-- Trip UPDATE WITH CHECK (058) used EXISTS (SELECT ... FROM trips t_prev ...).
-- That subquery is subject to trips SELECT RLS; edge cases can block the check even for
-- the row owner. Read the stored row with SECURITY DEFINER while still binding to auth.uid().

create or replace function public.trips_owner_shared_session_unchanged_from_stored(
  p_trip_id uuid,
  p_new_shared_session_id uuid
)
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
      and t.user_id = auth.uid()
      and t.deleted_at is null
      and t.shared_session_id is not distinct from p_new_shared_session_id
  );
$$;

revoke all on function public.trips_owner_shared_session_unchanged_from_stored(uuid, uuid) from public;
grant execute on function public.trips_owner_shared_session_unchanged_from_stored(uuid, uuid) to authenticated;

drop policy if exists "Users can update own trips" on public.trips;

create policy "Users can update own trips"
  on public.trips for update
  using (auth.uid() = user_id and deleted_at is null)
  with check (
    auth.uid() = user_id
    and (
      shared_session_id is null
      or public.is_session_member(shared_session_id, auth.uid())
      or public.trips_owner_shared_session_unchanged_from_stored(id, shared_session_id)
    )
  );

comment on function public.trips_owner_shared_session_unchanged_from_stored(uuid, uuid) is
  'True if auth user owns the trip, it is not soft-deleted, and shared_session_id matches stored (for trips UPDATE RLS).';

comment on policy "Users can update own trips" on public.trips is
  'Owner may update; shared_session_id null, or session member, or unchanged vs stored row (definer read).';
