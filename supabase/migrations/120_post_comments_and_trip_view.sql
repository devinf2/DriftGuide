-- Feed comments + a visibility-aware "view the trip behind a post" RPC.
--
-- Builds on 117_social_feed.sql:
--   * public.posts (author_id, trip_id, visibility, deleted_at)
--   * public.post_visible_to_reader(p_post_id, p_reader_id) -> boolean (SECURITY DEFINER)
--     true when the reader is the author, the post is public, or it's friends_only and
--     they're accepted friends — and neither party has blocked the other.
--
-- Comments are readable by anyone who can see the parent post; a user may add their own
-- comments and soft-delete their own, and a post author may soft-delete comments on their post.
-- post_trip_view lets anyone who can see a "whole trip" post open a read-only view of that
-- trip WITHOUT loosening normal trip RLS (the function gates on post visibility, not trip RLS).

-- ─────────────────────────────────────────────────────────────────────────────
-- Comments
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_post_comments_post
  on public.post_comments (post_id, created_at)
  where deleted_at is null;

alter table public.post_comments enable row level security;

-- Read a comment when it's live and the parent post is visible to you.
drop policy if exists "post_comments_select_when_post_visible" on public.post_comments;
create policy "post_comments_select_when_post_visible" on public.post_comments
  for select using (
    deleted_at is null
    and public.post_visible_to_reader(post_id, auth.uid())
  );

-- Add your own comment, only on a post you can see.
drop policy if exists "post_comments_insert_own" on public.post_comments;
create policy "post_comments_insert_own" on public.post_comments
  for insert with check (
    author_id = auth.uid()
    and public.post_visible_to_reader(post_id, auth.uid())
  );

-- Soft-delete (set deleted_at): your own comment, or any comment on a post you authored.
drop policy if exists "post_comments_update_own_or_post_author" on public.post_comments;
create policy "post_comments_update_own_or_post_author" on public.post_comments
  for update using (
    author_id = auth.uid()
    or auth.uid() = (select p.author_id from public.posts p where p.id = post_id)
  ) with check (
    author_id = auth.uid()
    or auth.uid() = (select p.author_id from public.posts p where p.id = post_id)
  );

-- Batched comment counts for the feed (mirrors post_reactions_summary). Only counts
-- comments on posts the caller can see.
create or replace function public.post_comment_counts(p_post_ids uuid[])
returns table(post_id uuid, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.post_id, count(*)::bigint
  from public.post_comments c
  where c.post_id = any(p_post_ids)
    and c.deleted_at is null
    and public.post_visible_to_reader(c.post_id, auth.uid())
  group by c.post_id;
$$;

revoke all on function public.post_comment_counts(uuid[]) from public;
grant execute on function public.post_comment_counts(uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- View the trip behind a post (visibility-aware; does NOT use trip RLS)
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns { trip, events, photos } as jsonb when the caller can see the post and the post
-- references a trip. Anyone who can see the post (public → anyone; friends_only → friends;
-- author always) can read the trip via this function, regardless of normal trip ownership.
create or replace function public.post_trip_view(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_result jsonb;
begin
  if not public.post_visible_to_reader(p_post_id, auth.uid()) then
    return null;
  end if;

  select trip_id into v_trip_id
  from public.posts
  where id = p_post_id and deleted_at is null;

  if v_trip_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'trip', to_jsonb(t.*),
    'location', (select to_jsonb(l.*) from public.locations l where l.id = t.location_id),
    'events', coalesce(
      (select jsonb_agg(to_jsonb(e.*) order by e.timestamp)
         from public.trip_events e
        where e.trip_id = v_trip_id),
      '[]'::jsonb
    ),
    'photos', coalesce(
      (select jsonb_agg(to_jsonb(ph.*))
         from public.photos ph
        where ph.trip_id = v_trip_id),
      '[]'::jsonb
    )
  )
  into v_result
  from public.trips t
  where t.id = v_trip_id;

  return v_result;
end;
$$;

revoke all on function public.post_trip_view(uuid) from public;
grant execute on function public.post_trip_view(uuid) to authenticated;
