-- Invites stay pending until the invitee links a trip. Allow pending invitees to (1) list
-- session trips for template resolution and (2) set shared_session_id on their own trips
-- before they appear in session_members.

create or replace function public.is_pending_session_invitee(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.session_invites si
    where si.shared_session_id = p_session_id
      and si.invitee_id = auth.uid()
      and si.status = 'pending'
      and si.expires_at > now()
  );
$$;

revoke all on function public.is_pending_session_invitee(uuid) from public;
grant execute on function public.is_pending_session_invitee(uuid) to authenticated;

comment on function public.is_pending_session_invitee(uuid) is
  'True if auth.uid() has a non-expired pending session_invites row for this shared_session_id.';

create or replace function public.list_trips_in_shared_session(p_session_id uuid)
returns setof public.trips
language sql
stable
security definer
set search_path = public
as $$
  select t.*
  from public.trips t
  where t.shared_session_id = p_session_id
    and t.deleted_at is null
    and (
      public.is_session_member(p_session_id, auth.uid())
      or public.is_pending_session_invitee(p_session_id)
    );
$$;

comment on function public.list_trips_in_shared_session(uuid) is
  'Returns non-deleted trips in the session for members and for pending invitees (pre-accept link flow).';

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
      or (
        shared_session_id is not null
        and public.is_pending_session_invitee(shared_session_id)
      )
    )
  );

comment on policy "Users can update own trips" on public.trips is
  'Owner may update; shared_session_id null, session member, unchanged vs stored, or pending invitee attaching to that session.';
