-- Trip upserts (INSERT/UPDATE WITH CHECK) require is_session_member(shared_session_id, uid).
-- Session creators must always satisfy this even if session_members is missing a row (bad state / race).

create or replace function public.is_session_member(p_session_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.session_members sm
    where sm.shared_session_id = p_session_id
      and sm.user_id = p_user_id
  )
  or exists (
    select 1
    from public.shared_sessions ss
    where ss.id = p_session_id
      and ss.created_by = p_user_id
  );
$$;

comment on function public.is_session_member(uuid, uuid) is
  'True if user is in session_members or is the shared_sessions.created_by (creator). Used by trips RLS.';
