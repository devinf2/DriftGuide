-- Richer denormalized catch facts on posts + opt-in location.
--
-- Builds on 117_social_feed.sql (public.posts already has species / size_inches / fly_name).
-- These columns are display-only snapshots captured at publish time, mirroring the
-- existing species/size/fly pattern. The feed RPCs (feed_friends / feed_discover) return
-- `setof public.posts` via `select p.*`, so new columns flow through with no RPC change.
--
-- Location is OPT-IN: location_name is only written when the author chooses to include it
-- in the composer. A null location_name means "don't reveal where this was caught".

alter table public.posts
  add column if not exists depth_ft numeric,
  add column if not exists presentation text,
  add column if not exists location_name text;

comment on column public.posts.depth_ft is 'Denormalized catch depth (feet) captured at publish time; display-only.';
comment on column public.posts.presentation is 'Denormalized presentation method (dry/nymph/streamer/wet/other); display-only.';
comment on column public.posts.location_name is 'Water/location name — only set when the author opts in to share location.';
