-- Own trips: finishing or editing must not fail RLS when shared_session_id is unchanged.
-- Otherwise any hiccup in session_members / is_session_member() blocks status/end_time updates
-- even though the row was already validly linked (parent session + child trip logs model).

drop policy if exists "Users can update own trips" on public.trips;

create policy "Users can update own trips"
  on public.trips for update
  using (auth.uid() = user_id and deleted_at is null)
  with check (
    auth.uid() = user_id
    and (
      shared_session_id is null
      or public.is_session_member(shared_session_id, auth.uid())
      or exists (
        select 1
        from public.trips t_prev
        where t_prev.id = trips.id
          and t_prev.user_id = auth.uid()
          and t_prev.shared_session_id is not distinct from trips.shared_session_id
      )
    )
  );

comment on policy "Users can update own trips" on public.trips is
  'Owner may update; shared_session_id must be null, or member of session, or unchanged from prior row.';
