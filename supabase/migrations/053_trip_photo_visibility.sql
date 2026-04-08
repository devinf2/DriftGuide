-- Default + per-trip visibility for trip-linked photos on profiles (private / friends_only / public).
-- Relies on public.accepted_friends from migration 052.

create type public.trip_photo_visibility as enum ('private', 'friends_only', 'public');

alter table public.profiles
  add column if not exists default_trip_photo_visibility public.trip_photo_visibility not null default 'private';

comment on column public.profiles.default_trip_photo_visibility is
  'Default for new trips: who may see trip photos on your profile (not journal timeline).';

alter table public.trips
  add column if not exists trip_photo_visibility public.trip_photo_visibility null;

comment on column public.trips.trip_photo_visibility is
  'Override profile default for this trip’s album photos on profile; null = use profiles.default_trip_photo_visibility.';

create or replace function public.effective_trip_photo_visibility(p_trip_id uuid)
returns public.trip_photo_visibility
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    t.trip_photo_visibility,
    pr.default_trip_photo_visibility,
    'private'::public.trip_photo_visibility
  )
  from public.trips t
  inner join public.profiles pr on pr.id = t.user_id
  where t.id = p_trip_id
    and t.deleted_at is null
  limit 1;
$$;

revoke all on function public.effective_trip_photo_visibility(uuid) from public;
grant execute on function public.effective_trip_photo_visibility(uuid) to authenticated;

-- Non-owners: read trip-linked photos when trip owner chose public or (friends_only + accepted friend).
-- Session peers still use "Users can view session trip photos". Owners use "Users can view own photos".
drop policy if exists "Trip photos visible by profile and trip sharing" on public.photos;
create policy "Trip photos visible by profile and trip sharing"
  on public.photos for select
  to authenticated
  using (
    deleted_at is null
    and trip_id is not null
    and auth.uid() is not null
    and exists (
      select 1
      from public.trips t
      where t.id = photos.trip_id
        and t.deleted_at is null
        and (
          public.effective_trip_photo_visibility(t.id) = 'public'::public.trip_photo_visibility
          or (
            public.effective_trip_photo_visibility(t.id) = 'friends_only'::public.trip_photo_visibility
            and public.accepted_friends(t.user_id, auth.uid())
          )
        )
    )
  );
