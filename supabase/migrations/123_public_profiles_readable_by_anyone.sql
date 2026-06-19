-- Allow any authenticated user to read another angler's profile row, so that opening a
-- profile from friend search / the feed works even before a friendship exists. Previously
-- the only SELECT paths were "own profile" and "friend-visible profiles" (migration 046),
-- so a non-friend's profile failed to load ("Unavailable, can't load this profile").
--
-- This mirrors migration 122 (public trips readable by anyone): the profile row itself is
-- public among signed-in users, while the sensitive content — which trips/photos are shown
-- on that profile — stays governed by the trips RLS (non-friend -> public only).
--
-- Profiles carry no secrets (display name, names, avatar, username, friend code, home
-- region); display_name/avatar/username are already exposed via search_profiles_for_discovery.
-- Deleted accounts (account_deleted_at) remain hidden from everyone but the owner.

create policy "Profiles readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (account_deleted_at is null);
