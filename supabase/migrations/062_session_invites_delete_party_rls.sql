-- Decline (and inviter cancel) use DELETE from the client; RLS previously had no delete policy.
create policy "session_invites_delete_party"
  on public.session_invites for delete
  using (inviter_id = auth.uid() or invitee_id = auth.uid());
