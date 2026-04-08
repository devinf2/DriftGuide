-- Client trip sync: verify session membership the same way trips RLS does (is_session_member),
-- without depending on SELECT from session_members under nested policies.

create or replace function public.is_current_user_session_member(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_session_id is not null
    and public.is_session_member(p_session_id, auth.uid());
$$;

revoke all on function public.is_current_user_session_member(uuid) from public;
grant execute on function public.is_current_user_session_member(uuid) to authenticated;

comment on function public.is_current_user_session_member(uuid) is
  'True if auth.uid() is a member of the session (session_members or shared_sessions.created_by). For trip sync.';
