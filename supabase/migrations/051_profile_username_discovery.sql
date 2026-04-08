-- Optional @username (unique, lowercase) + discovery search by username or name.

alter table public.profiles
  add column if not exists username text;

comment on column public.profiles.username is
  'Optional unique handle (lowercase a–z, 0–9, underscore); used for friend discovery.';

create unique index if not exists idx_profiles_username_lower
  on public.profiles (lower(username))
  where
    username is not null
    and btrim(username) <> ''
    and account_deleted_at is null;

alter table public.profiles
  drop constraint if exists profiles_username_valid;

alter table public.profiles
  add constraint profiles_username_valid check (
    username is null
    or (
      length(username) between 3 and 20
      and username = lower(username)
      and username ~ '^[a-z0-9_]+$'
    )
  );

-- Set or clear username (validated + unique among active profiles).
create or replace function public.set_my_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_norm text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_username is null or btrim(p_username) = '' then
    update public.profiles
    set username = null
    where id = uid
      and account_deleted_at is null;
    return null;
  end if;

  v_norm := lower(btrim(p_username));
  if length(v_norm) < 3 or length(v_norm) > 20 then
    raise exception 'Username must be 3–20 characters';
  end if;
  if v_norm !~ '^[a-z0-9_]+$' then
    raise exception 'Username may only use lowercase letters, numbers, and underscores';
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(p.username) = v_norm
      and p.id is distinct from uid
      and p.account_deleted_at is null
  ) then
    raise exception 'Username is already taken';
  end if;

  update public.profiles
  set username = v_norm
  where id = uid
    and account_deleted_at is null;

  return v_norm;
end;
$$;

revoke all on function public.set_my_username(text) from public;
grant execute on function public.set_my_username(text) to authenticated;

comment on function public.set_my_username(text) is
  'Sets optional unique username (3–20 a–z/0–9/_), or clears when null/empty.';

-- Search other anglers by username, display name, or first/last name (authenticated only).
create or replace function public.search_profiles_for_discovery(p_query text, p_limit int default 20)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  friend_code text,
  username text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  q text := btrim(p_query);
  q_lower text;
  lim int;
  v_esc text;
  v_esc_lower text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if length(q) < 2 then
    raise exception 'Search must be at least 2 characters';
  end if;

  q_lower := lower(q);
  lim := least(greatest(coalesce(p_limit, 20), 1), 25);

  v_esc := replace(replace(replace(q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
  v_esc_lower := replace(replace(replace(q_lower, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');

  return query
  select
    p.id,
    p.display_name,
    p.avatar_url,
    p.friend_code,
    p.username
  from public.profiles p
  where
    p.account_deleted_at is null
    and p.id <> uid
    and (
      (
        p.username is not null
        and btrim(p.username) <> ''
        and (
          lower(p.username) = q_lower
          or lower(p.username) like v_esc_lower || '%' escape '\'
          or lower(p.username) like '%' || v_esc_lower || '%' escape '\'
        )
      )
      or (p.display_name is not null and p.display_name ilike '%' || v_esc || '%' escape '\')
      or (p.first_name is not null and p.first_name ilike '%' || v_esc || '%' escape '\')
      or (p.last_name is not null and p.last_name ilike '%' || v_esc || '%' escape '\')
    )
  order by
    case
      when lower(p.username) = q_lower then 0
      when lower(p.username) like v_esc_lower || '%' escape '\' then 1
      when p.display_name ilike v_esc || '%' escape '\' then 2
      else 3
    end,
    p.display_name nulls last
  limit lim;
end;
$$;

revoke all on function public.search_profiles_for_discovery(text, int) from public;
grant execute on function public.search_profiles_for_discovery(text, int) to authenticated;

comment on function public.search_profiles_for_discovery(text, int) is
  'Find up to N other profiles by username or name; min 2 chars; LIKE metacharacters escaped.';
