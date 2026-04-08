-- Friend codes: 4–5 alphanumeric (stored lowercase), set once only (no rotation).

create or replace function public.set_my_friend_code(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_norm text := lower(trim(p_code));
  current_code text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select nullif(trim(p.friend_code), '') into current_code
  from public.profiles p
  where p.id = uid;

  if current_code is not null then
    raise exception 'Friend code is already set and cannot be changed';
  end if;

  if v_norm is null or length(v_norm) < 4 or length(v_norm) > 5 then
    raise exception 'Friend code must be 4 or 5 letters or numbers';
  end if;

  if v_norm !~ '^[a-z0-9]+$' then
    raise exception 'Friend code may only contain letters and numbers (no spaces or symbols)';
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(p.friend_code) = v_norm
      and p.id is distinct from uid
      and p.account_deleted_at is null
  ) then
    raise exception 'Friend code is already taken';
  end if;

  update public.profiles
  set friend_code = v_norm
  where id = uid and account_deleted_at is null;

  return v_norm;
end;
$$;

comment on function public.set_my_friend_code(text) is
  'Sets friend code once: 4–5 a–z/0–9, case-insensitive uniqueness.';
