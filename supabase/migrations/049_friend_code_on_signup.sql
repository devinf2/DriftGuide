-- Auto-assign a short friend code when a profile is created (auth.users trigger).
-- Backfill existing profiles that still have no code.

create or replace function public.generate_unique_friend_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  chars constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  len int;
  candidate text;
  i int;
  pos int;
  attempt int;
begin
  for attempt in 1..48 loop
    len := case when random() < 0.5 then 4 else 5 end;
    candidate := '';
    for i in 1..len loop
      pos := 1 + floor(random() * length(chars))::int;
      candidate := candidate || substr(chars, pos, 1);
    end loop;

    if not exists (
      select 1
      from public.profiles p
      where p.friend_code is not null
        and btrim(p.friend_code) <> ''
        and lower(p.friend_code) = candidate
        and p.account_deleted_at is null
    ) then
      return candidate;
    end if;
  end loop;

  -- Rare: fall back to 5 hex chars (still unique-checked)
  loop
    candidate := substr(replace(gen_random_uuid()::text, '-', ''), 1, 5);
    exit when not exists (
      select 1
      from public.profiles p
      where p.friend_code is not null
        and btrim(p.friend_code) <> ''
        and lower(p.friend_code) = candidate
        and p.account_deleted_at is null
    );
  end loop;
  return candidate;
end;
$$;

revoke all on function public.generate_unique_friend_code() from public;

comment on function public.generate_unique_friend_code() is
  'Returns a new unused 4–5 char friend code (or 5 hex fallback). Used by signup trigger and backfill.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, friend_code)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1),
      'Angler'
    ),
    public.generate_unique_friend_code()
  );
  return new;
end;
$$;

-- Existing users without a code
do $$
declare
  r record;
begin
  for r in
    select id
    from public.profiles
    where account_deleted_at is null
      and (friend_code is null or btrim(friend_code) = '')
  loop
    update public.profiles
    set friend_code = public.generate_unique_friend_code()
    where id = r.id;
  end loop;
end $$;
