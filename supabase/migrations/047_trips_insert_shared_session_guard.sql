-- Ensure new trips cannot be inserted already linked to a session the user is not a member of.
drop policy if exists "Users can insert own trips" on public.trips;

create policy "Users can insert own trips"
  on public.trips for insert
  with check (
    auth.uid() = user_id
    and (
      shared_session_id is null
      or public.is_session_member(shared_session_id, auth.uid())
    )
  );
