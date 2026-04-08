-- Fix fishing group creation: INSERT ... RETURNING runs SELECT RLS on the new row.
-- Until session_members includes the creator, is_session_member() is false, so the client
-- got zero rows and createSharedSession() failed even though the insert succeeded.

drop policy if exists "shared_sessions_select_member" on public.shared_sessions;

create policy "shared_sessions_select_member_or_creator"
  on public.shared_sessions for select
  using (
    public.is_session_member(id, auth.uid())
    or created_by = auth.uid()
  );
