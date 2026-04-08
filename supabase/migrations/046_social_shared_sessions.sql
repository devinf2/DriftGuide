-- Friends, shared fishing sessions, and trip grouping (child trips share a session id).
-- Helpers are SECURITY DEFINER with fixed search_path for RLS use.

-- ---------------------------------------------------------------------------
-- Friendships: one row per pair (profile_min < profile_max)
-- ---------------------------------------------------------------------------
create type public.friendship_status as enum ('pending', 'accepted', 'blocked');

create table public.friendships (
  profile_min uuid not null references public.profiles (id) on delete cascade,
  profile_max uuid not null references public.profiles (id) on delete cascade,
  status public.friendship_status not null default 'pending',
  requested_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_min, profile_max),
  constraint friendships_ordered check (profile_min < profile_max),
  constraint friendships_requester_is_participant check (
    requested_by = profile_min or requested_by = profile_max
  )
);

create index idx_friendships_requested_by on public.friendships (requested_by);
create index idx_friendships_status on public.friendships (status);

-- ---------------------------------------------------------------------------
-- Friend code for discovery (exact lookup via RPC)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists friend_code text;

create unique index if not exists idx_profiles_friend_code_lower
  on public.profiles (lower(friend_code))
  where friend_code is not null and account_deleted_at is null;

comment on column public.profiles.friend_code is
  'Case-insensitive unique handle for friend lookup; optional.';

-- ---------------------------------------------------------------------------
-- Shared sessions
-- ---------------------------------------------------------------------------
create table public.shared_sessions (
  id uuid primary key default gen_random_uuid (),
  created_by uuid not null references public.profiles (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index idx_shared_sessions_created_by on public.shared_sessions (created_by);

create type public.session_member_role as enum ('owner', 'member');

create table public.session_members (
  shared_session_id uuid not null references public.shared_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.session_member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (shared_session_id, user_id)
);

create index idx_session_members_user on public.session_members (user_id);

create type public.session_invite_status as enum ('pending', 'accepted', 'declined', 'expired');

create table public.session_invites (
  id uuid primary key default gen_random_uuid (),
  shared_session_id uuid not null references public.shared_sessions (id) on delete cascade,
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  invitee_id uuid not null references public.profiles (id) on delete cascade,
  status public.session_invite_status not null default 'pending',
  token text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique (shared_session_id, invitee_id)
);

create index idx_session_invites_invitee_pending
  on public.session_invites (invitee_id)
  where status = 'pending';

create index idx_session_invites_token on public.session_invites (token);

-- Link trips to a session (at most one session per trip)
alter table public.trips
  add column if not exists shared_session_id uuid references public.shared_sessions (id) on delete set null;

create index if not exists idx_trips_shared_session_id
  on public.trips (shared_session_id)
  where shared_session_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER helpers
-- ---------------------------------------------------------------------------
create or replace function public.friendship_pair(a uuid, b uuid)
returns table(profile_min uuid, profile_max uuid)
language sql
immutable
as $$
  select case when a < b then a else b end, case when a < b then b else a end;
$$;

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
  );
$$;

create or replace function public.user_can_read_trip_via_session(p_trip_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and t.deleted_at is null
      and t.shared_session_id is not null
      and public.is_session_member(t.shared_session_id, p_user_id)
      and t.user_id is distinct from p_user_id
  );
$$;

create or replace function public.user_can_read_trip(p_trip_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and t.deleted_at is null
      and t.user_id = p_user_id
  )
  or public.user_can_read_trip_via_session(p_trip_id, p_user_id);
$$;

create or replace function public.profile_visible_to_reader(p_profile_id uuid, p_reader_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = p_profile_id
      and pr.account_deleted_at is null
      and (
        p_profile_id = p_reader_id
        or exists (
          select 1
          from public.friendships f
          where
            f.profile_min = least(p_profile_id, p_reader_id)
            and f.profile_max = greatest(p_profile_id, p_reader_id)
            and f.status in ('pending', 'accepted')
        )
      )
  );
$$;

create or replace function public.user_is_session_owner(p_session_id uuid, p_user_id uuid)
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
      and sm.role = 'owner'
  );
$$;

-- Exact friend-code lookup (limited fields)
create or replace function public.lookup_profile_by_friend_code(p_code text)
returns table(
  id uuid,
  display_name text,
  avatar_url text,
  friend_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text := lower(trim(p_code));
begin
  if v_norm is null or length(v_norm) < 2 then
    return;
  end if;
  return query
  select p.id, p.display_name, p.avatar_url, p.friend_code
  from public.profiles p
  where
    lower(p.friend_code) = v_norm
    and p.account_deleted_at is null;
end;
$$;

revoke all on function public.lookup_profile_by_friend_code(text) from public;
grant execute on function public.lookup_profile_by_friend_code(text) to authenticated;

-- Set or rotate friend code (unique, case-insensitive)
create or replace function public.set_my_friend_code(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_norm text := lower(trim(p_code));
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if v_norm is null or length(v_norm) < 3 or length(v_norm) > 32 then
    raise exception 'Friend code must be 3–32 characters';
  end if;
  if v_norm !~ '^[a-z0-9_]+$' then
    raise exception 'Friend code may only contain letters, numbers, and underscores';
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

revoke all on function public.set_my_friend_code(text) from public;
grant execute on function public.set_my_friend_code(text) to authenticated;

revoke all on function public.is_session_member(uuid, uuid) from public;
grant execute on function public.is_session_member(uuid, uuid) to authenticated;

revoke all on function public.user_can_read_trip_via_session(uuid, uuid) from public;
grant execute on function public.user_can_read_trip_via_session(uuid, uuid) to authenticated;

revoke all on function public.user_can_read_trip(uuid, uuid) from public;
grant execute on function public.user_can_read_trip(uuid, uuid) to authenticated;

revoke all on function public.profile_visible_to_reader(uuid, uuid) from public;
grant execute on function public.profile_visible_to_reader(uuid, uuid) to authenticated;

revoke all on function public.user_is_session_owner(uuid, uuid) from public;
grant execute on function public.user_is_session_owner(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: friendships
-- ---------------------------------------------------------------------------
alter table public.friendships enable row level security;

create policy "friendships_select_participants"
  on public.friendships for select
  using (
    auth.uid() = profile_min
    or auth.uid() = profile_max
  );

create policy "friendships_insert_requester"
  on public.friendships for insert
  with check (
    auth.uid() = requested_by
    and (auth.uid() = profile_min or auth.uid() = profile_max)
    and status = 'pending'
  );

create policy "friendships_update_participants"
  on public.friendships for update
  using (auth.uid() = profile_min or auth.uid() = profile_max)
  with check (auth.uid() = profile_min or auth.uid() = profile_max);

create policy "friendships_delete_participants"
  on public.friendships for delete
  using (auth.uid() = profile_min or auth.uid() = profile_max);

-- ---------------------------------------------------------------------------
-- RLS: shared_sessions
-- ---------------------------------------------------------------------------
alter table public.shared_sessions enable row level security;

create policy "shared_sessions_select_member"
  on public.shared_sessions for select
  using (public.is_session_member(id, auth.uid()));

create policy "shared_sessions_insert_authenticated"
  on public.shared_sessions for insert
  with check (auth.uid() = created_by);

create policy "shared_sessions_update_owner"
  on public.shared_sessions for update
  using (public.user_is_session_owner(id, auth.uid()))
  with check (public.user_is_session_owner(id, auth.uid()));

create policy "shared_sessions_delete_owner"
  on public.shared_sessions for delete
  using (public.user_is_session_owner(id, auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS: session_members
-- ---------------------------------------------------------------------------
alter table public.session_members enable row level security;

create policy "session_members_select_member"
  on public.session_members for select
  using (public.is_session_member(shared_session_id, auth.uid()));

-- Creator becomes owner: insert self on session create (handled in app) + owner can add members
create policy "session_members_insert_owner_or_self_join"
  on public.session_members for insert
  with check (
    user_id = auth.uid()
    or public.user_is_session_owner(shared_session_id, auth.uid())
  );

create policy "session_members_delete_self_or_owner"
  on public.session_members for delete
  using (
    user_id = auth.uid()
    or public.user_is_session_owner(shared_session_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- RLS: session_invites
-- ---------------------------------------------------------------------------
alter table public.session_invites enable row level security;

create policy "session_invites_select_party"
  on public.session_invites for select
  using (inviter_id = auth.uid() or invitee_id = auth.uid());

create policy "session_invites_insert_member"
  on public.session_invites for insert
  with check (
    inviter_id = auth.uid()
    and public.is_session_member(shared_session_id, auth.uid())
    and invitee_id is distinct from auth.uid()
  );

create policy "session_invites_update_party"
  on public.session_invites for update
  using (inviter_id = auth.uid() or invitee_id = auth.uid())
  with check (inviter_id = auth.uid() or invitee_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Profiles: allow reading profiles visible to reader (friends / pending)
-- ---------------------------------------------------------------------------
drop policy if exists "Users can view own profile" on public.profiles;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can view friend-visible profiles"
  on public.profiles for select
  using (public.profile_visible_to_reader(id, auth.uid()) and auth.uid() is distinct from id);

-- ---------------------------------------------------------------------------
-- Trips: extend SELECT for session peers; tighten UPDATE shared_session_id
-- ---------------------------------------------------------------------------
drop policy if exists "Users can view own trips" on public.trips;

create policy "Users can view own trips"
  on public.trips for select
  using (
    deleted_at is null
    and (
      auth.uid() = user_id
      or public.user_can_read_trip_via_session(id, auth.uid())
    )
  );

drop policy if exists "Users can update own trips" on public.trips;

create policy "Users can update own trips"
  on public.trips for update
  using (auth.uid() = user_id and deleted_at is null)
  with check (
    auth.uid() = user_id
    and (
      shared_session_id is null
      or public.is_session_member(shared_session_id, auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- trip_events
-- ---------------------------------------------------------------------------
drop policy if exists "Users can view own trip events" on public.trip_events;

create policy "Users can view own trip events"
  on public.trip_events for select
  using (public.user_can_read_trip(trip_id, auth.uid()));

drop policy if exists "Users can insert own trip events" on public.trip_events;

create policy "Users can insert own trip events"
  on public.trip_events for insert
  with check (
    exists (
      select 1
      from public.trips t
      where
        t.id = trip_events.trip_id
        and t.user_id = auth.uid()
        and t.deleted_at is null
    )
  );

drop policy if exists "Users can update own trip events" on public.trip_events;

create policy "Users can update own trip events"
  on public.trip_events for update
  using (
    exists (
      select 1
      from public.trips t
      where t.id = trip_events.trip_id and t.user_id = auth.uid() and t.deleted_at is null
    )
  );

drop policy if exists "Users can delete own trip events" on public.trip_events;

create policy "Users can delete own trip events"
  on public.trip_events for delete
  using (
    exists (
      select 1
      from public.trips t
      where t.id = trip_events.trip_id and t.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- catches
-- ---------------------------------------------------------------------------
drop policy if exists "Users can view own catches" on public.catches;

create policy "Users can view own catches"
  on public.catches for select
  using (
    deleted_at is null
    and (
      auth.uid() = user_id
      or public.user_can_read_trip_via_session(trip_id, auth.uid())
    )
  );

-- inserts/updates/deletes unchanged logic but re-apply for clarity (owner only)
drop policy if exists "Users can insert own catches" on public.catches;
create policy "Users can insert own catches"
  on public.catches for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own catches" on public.catches;
create policy "Users can update own catches"
  on public.catches for update
  using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own catches" on public.catches;
create policy "Users can delete own catches"
  on public.catches for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- photos: trip-scoped readable to session peers
-- ---------------------------------------------------------------------------
drop policy if exists "Users can view own photos" on public.photos;

create policy "Users can view own photos"
  on public.photos for select
  using (
    deleted_at is null
    and auth.uid() = user_id
  );

create policy "Users can view session trip photos"
  on public.photos for select
  using (
    deleted_at is null
    and trip_id is not null
    and public.user_can_read_trip_via_session(trip_id, auth.uid())
  );
