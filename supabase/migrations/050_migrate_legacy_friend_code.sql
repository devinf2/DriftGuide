-- One-time migration: replace legacy long friend codes with a generated 4–5 char code.
-- Short codes (^[a-z0-9]{4,5}$) are unchanged.

create or replace function public.migrate_legacy_friend_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_code text;
  new_code text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select nullif(trim(p.friend_code), '') into current_code
  from public.profiles p
  where p.id = uid
    and p.account_deleted_at is null;

  if current_code is null then
    raise exception 'No friend code set; use claim friend code in the app';
  end if;

  if lower(current_code) ~ '^[a-z0-9]{4,5}$' then
    raise exception 'Friend code is already the short format';
  end if;

  new_code := public.generate_unique_friend_code();

  update public.profiles
  set friend_code = new_code
  where id = uid
    and account_deleted_at is null;

  return new_code;
end;
$$;

revoke all on function public.migrate_legacy_friend_code() from public;
grant execute on function public.migrate_legacy_friend_code() to authenticated;

comment on function public.migrate_legacy_friend_code() is
  'Replaces a legacy (non 4–5 a–z/0–9) friend code once; short codes are rejected.';
