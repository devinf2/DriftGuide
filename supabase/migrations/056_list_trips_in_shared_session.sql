-- Session members must list every child trip linked to the group (for merged timeline/photos),
-- even when per-row trips SELECT policies would otherwise hide a peer's row from the inviter.
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
    and public.is_session_member(p_session_id, auth.uid());
$$;

revoke all on function public.list_trips_in_shared_session(uuid) from public;
grant execute on function public.list_trips_in_shared_session(uuid) to authenticated;

comment on function public.list_trips_in_shared_session(uuid) is
  'Returns all non-deleted trips in the session for current member; bypasses trips RLS for cross-peer listing.';
