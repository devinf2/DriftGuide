-- WS-H: Social feed. Users publish a post from a completed trip or an individual catch and
-- choose visibility per post (private / friends_only / public). Friends' friends-or-public posts
-- and all public posts appear in a browsable feed with reactions.
--
-- Reuses the existing social graph from 046/052:
--   * public.friendships (profile_min < profile_max, status enum pending|accepted|blocked)
--   * public.accepted_friends(a, b)  -> boolean (SECURITY DEFINER)
-- Reuses the visibility vocabulary from 053:
--   * public.trip_photo_visibility enum ('private','friends_only','public')
-- Reuses per-catch attribution from 115 (catches.caught_by_user_id) at the display layer.
--
-- Visibility in plain English (see public.post_visible_to_reader):
--   A viewer may read a post when it is not soft-deleted AND neither party has blocked the other AND
--     - the viewer is the author, OR
--     - visibility = 'public', OR
--     - visibility = 'friends_only' AND the viewer is an accepted friend of the author.
--   'private' posts are visible only to the author.
-- Reactions are readable exactly when the parent post is readable; a user may only
-- insert/delete their own reactions.

-- ---------------------------------------------------------------------------
-- Block helper: true if either user has blocked the other.
-- friendships.status = 'blocked' models a block on the pair row (see 046).
-- ---------------------------------------------------------------------------
create or replace function public.users_blocked(profile_a uuid, profile_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships f
    where f.profile_min = least(profile_a, profile_b)
      and f.profile_max = greatest(profile_a, profile_b)
      and f.status = 'blocked'::public.friendship_status
  );
$$;

revoke all on function public.users_blocked(uuid, uuid) from public;
grant execute on function public.users_blocked(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- posts
-- media: jsonb array of photo url strings (remote https). Pulled from the catch/trip album
-- at publish time so the feed never has to re-read trip-scoped photo RLS.
-- ---------------------------------------------------------------------------
create table public.posts (
  id uuid primary key default gen_random_uuid (),
  author_id uuid not null references public.profiles (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete set null,
  -- the originating timeline event (catch) when the post is about a single catch
  catch_event_id uuid references public.trip_events (id) on delete set null,
  caption text,
  -- denormalized catch facts captured at publish time (species/size/fly), display-only
  species text,
  size_inches numeric,
  fly_name text,
  -- denormalized "who caught it" from catches.caught_by_user_id (115); null = author
  caught_by_user_id uuid references public.profiles (id) on delete set null,
  media jsonb not null default '[]'::jsonb,
  visibility public.trip_photo_visibility not null default 'friends_only',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint posts_caption_len check (caption is null or char_length(caption) <= 2000)
);

create index idx_posts_author_created
  on public.posts (author_id, created_at desc)
  where deleted_at is null;

create index idx_posts_public_created
  on public.posts (created_at desc)
  where deleted_at is null and visibility = 'public'::public.trip_photo_visibility;

create index idx_posts_trip_id on public.posts (trip_id) where trip_id is not null;

-- ---------------------------------------------------------------------------
-- post_reactions
-- ---------------------------------------------------------------------------
create table public.post_reactions (
  id uuid primary key default gen_random_uuid (),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  constraint post_reactions_reaction_chk check (reaction in ('fire', 'fish', 'like', 'net', 'wow')),
  unique (post_id, user_id, reaction)
);

create index idx_post_reactions_post on public.post_reactions (post_id);
create index idx_post_reactions_user on public.post_reactions (user_id);

-- ---------------------------------------------------------------------------
-- post_reports (moderation of public posts)
-- ---------------------------------------------------------------------------
create table public.post_reports (
  id uuid primary key default gen_random_uuid (),
  post_id uuid not null references public.posts (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (post_id, reporter_id)
);

create index idx_post_reports_post on public.post_reports (post_id);

-- ---------------------------------------------------------------------------
-- activity_events: retention trail for the future push workstream (WS-G).
-- One row per feed-worthy action (post published, friend reacted). WS-G consumes
-- unprocessed rows to fan out friend-activity pushes. TODO(WS-G): add a worker /
-- edge function that reads where processed_at is null, sends pushes, stamps processed_at.
-- ---------------------------------------------------------------------------
create table public.activity_events (
  id uuid primary key default gen_random_uuid (),
  -- who performed the action (becomes the push "actor")
  actor_id uuid not null references public.profiles (id) on delete cascade,
  -- intended recipient of the eventual notification (post author for reactions; null = fan-out to actor's friends for new posts)
  recipient_id uuid references public.profiles (id) on delete cascade,
  event_type text not null check (event_type in ('post_created', 'post_reaction')),
  post_id uuid references public.posts (id) on delete cascade,
  reaction text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index idx_activity_events_unprocessed
  on public.activity_events (created_at)
  where processed_at is null;

create index idx_activity_events_recipient on public.activity_events (recipient_id);

-- ---------------------------------------------------------------------------
-- Readability helper
-- ---------------------------------------------------------------------------
create or replace function public.post_visible_to_reader(p_post_id uuid, p_reader_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.posts p
    where p.id = p_post_id
      and p.deleted_at is null
      and not public.users_blocked(p.author_id, p_reader_id)
      and (
        p.author_id = p_reader_id
        or p.visibility = 'public'::public.trip_photo_visibility
        or (
          p.visibility = 'friends_only'::public.trip_photo_visibility
          and public.accepted_friends(p.author_id, p_reader_id)
        )
      )
  );
$$;

revoke all on function public.post_visible_to_reader(uuid, uuid) from public;
grant execute on function public.post_visible_to_reader(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: posts
-- ---------------------------------------------------------------------------
alter table public.posts enable row level security;

create policy "posts_select_visible"
  on public.posts for select
  to authenticated
  using (
    deleted_at is null
    and (
      author_id = auth.uid()
      or (
        not public.users_blocked(author_id, auth.uid())
        and (
          visibility = 'public'::public.trip_photo_visibility
          or (
            visibility = 'friends_only'::public.trip_photo_visibility
            and public.accepted_friends(author_id, auth.uid())
          )
        )
      )
    )
  );

create policy "posts_insert_own"
  on public.posts for insert
  to authenticated
  with check (author_id = auth.uid());

create policy "posts_update_own"
  on public.posts for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "posts_delete_own"
  on public.posts for delete
  to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS: post_reactions (readable when the post is readable; own writes only)
-- ---------------------------------------------------------------------------
alter table public.post_reactions enable row level security;

create policy "post_reactions_select_when_post_visible"
  on public.post_reactions for select
  to authenticated
  using (public.post_visible_to_reader(post_id, auth.uid()));

create policy "post_reactions_insert_own"
  on public.post_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.post_visible_to_reader(post_id, auth.uid())
  );

create policy "post_reactions_delete_own"
  on public.post_reactions for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS: post_reports (reporter can create + see own reports)
-- ---------------------------------------------------------------------------
alter table public.post_reports enable row level security;

create policy "post_reports_select_own"
  on public.post_reports for select
  to authenticated
  using (reporter_id = auth.uid());

create policy "post_reports_insert_own"
  on public.post_reports for insert
  to authenticated
  with check (
    reporter_id = auth.uid()
    and public.post_visible_to_reader(post_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- RLS: activity_events (actor or recipient may read own; insert own actor rows)
-- ---------------------------------------------------------------------------
alter table public.activity_events enable row level security;

create policy "activity_events_select_party"
  on public.activity_events for select
  to authenticated
  using (actor_id = auth.uid() or recipient_id = auth.uid());

create policy "activity_events_insert_actor"
  on public.activity_events for insert
  to authenticated
  with check (actor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Triggers: write the WS-G retention trail automatically.
-- ---------------------------------------------------------------------------
create or replace function public.tg_posts_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- recipient_id null => WS-G fans this out to the author's accepted friends.
  if (tg_op = 'INSERT') and new.deleted_at is null then
    insert into public.activity_events (actor_id, recipient_id, event_type, post_id)
    values (new.author_id, null, 'post_created', new.id);
  end if;
  return new;
end;
$$;

create trigger trg_posts_activity
  after insert on public.posts
  for each row execute function public.tg_posts_activity();

create or replace function public.tg_post_reactions_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.posts where id = new.post_id;
  -- Notify the post author when someone else reacts.
  if v_author is not null and v_author is distinct from new.user_id then
    insert into public.activity_events (actor_id, recipient_id, event_type, post_id, reaction)
    values (new.user_id, v_author, 'post_reaction', new.post_id, new.reaction);
  end if;
  return new;
end;
$$;

create trigger trg_post_reactions_activity
  after insert on public.post_reactions
  for each row execute function public.tg_post_reactions_activity();

-- ---------------------------------------------------------------------------
-- RPCs: paginated feeds + reaction summary. Keyset pagination on created_at
-- (before = exclusive upper bound; null = newest page).
-- ---------------------------------------------------------------------------

-- Friends feed: friends' friends-only-or-public posts plus the viewer's own posts.
create or replace function public.feed_friends(p_limit int default 20, p_before timestamptz default null)
returns setof public.posts
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.posts p
  where p.deleted_at is null
    and (p_before is null or p.created_at < p_before)
    and not public.users_blocked(p.author_id, auth.uid())
    and (
      p.author_id = auth.uid()
      or (
        public.accepted_friends(p.author_id, auth.uid())
        and p.visibility in (
          'friends_only'::public.trip_photo_visibility,
          'public'::public.trip_photo_visibility
        )
      )
    )
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.feed_friends(int, timestamptz) from public;
grant execute on function public.feed_friends(int, timestamptz) to authenticated;

-- Discover feed: all public posts, excluding posts where the viewer is blocked or has blocked.
create or replace function public.feed_discover(p_limit int default 20, p_before timestamptz default null)
returns setof public.posts
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.posts p
  where p.deleted_at is null
    and p.visibility = 'public'::public.trip_photo_visibility
    and (p_before is null or p.created_at < p_before)
    and not public.users_blocked(p.author_id, auth.uid())
  order by p.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.feed_discover(int, timestamptz) from public;
grant execute on function public.feed_discover(int, timestamptz) to authenticated;

-- Reaction summary for a set of posts: counts per reaction + whether the viewer reacted.
create or replace function public.post_reactions_summary(p_post_ids uuid[])
returns table (
  post_id uuid,
  reaction text,
  count bigint,
  reacted_by_me boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.post_id,
    r.reaction,
    count(*)::bigint as count,
    bool_or(r.user_id = auth.uid()) as reacted_by_me
  from public.post_reactions r
  where r.post_id = any (p_post_ids)
    and public.post_visible_to_reader(r.post_id, auth.uid())
  group by r.post_id, r.reaction;
$$;

revoke all on function public.post_reactions_summary(uuid[]) from public;
grant execute on function public.post_reactions_summary(uuid[]) to authenticated;
