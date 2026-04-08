-- Account closure: soft-delete user content + mark profile; keep auth row for audit.
-- Client calls public.soft_delete_my_account() after confirmation, then signs out.

alter table public.profiles
  add column if not exists account_deleted_at timestamptz;

comment on column public.profiles.account_deleted_at is
  'When set, the user closed their account; app should sign them out and block normal use.';

alter table public.photos
  add column if not exists deleted_at timestamptz;

comment on column public.photos.deleted_at is 'Soft delete — row retained but hidden from normal reads.';

alter table public.catches
  add column if not exists deleted_at timestamptz;

comment on column public.catches.deleted_at is 'Soft delete — row retained; community row removed via trigger.';

create index if not exists idx_photos_user_deleted on public.photos (user_id) where deleted_at is null;
create index if not exists idx_catches_user_deleted on public.catches (user_id) where deleted_at is null;

-- Community: do not re-sync rows when a catch is soft-deleted; remove anonymized copy.
create or replace function public.sync_community_catch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tf text;
  tsess text;
  tplan timestamptz;
  tstart timestamptz;
  tend timestamptz;
  tst text;
begin
  if new.deleted_at is not null then
    delete from public.community_catches where id = new.id;
    return new;
  end if;

  select
    t.fishing_type::text,
    t.session_type,
    t.planned_date,
    t.start_time,
    t.end_time,
    t.status::text
  into tf, tsess, tplan, tstart, tend, tst
  from public.trips t
  where t.id = new.trip_id;

  insert into public.community_catches (
    id, location_id, latitude, longitude, timestamp, species, size_inches, quantity, released,
    depth_ft, structure, caught_on_fly, fly_pattern, fly_size, fly_color, presentation_method,
    conditions_snapshot_id, note,
    trip_fishing_type, trip_session_type, trip_planned_date, trip_start_time, trip_end_time, trip_status
  ) values (
    new.id, new.location_id, new.latitude, new.longitude, new.timestamp, new.species, new.size_inches,
    new.quantity, new.released, new.depth_ft, new.structure, new.caught_on_fly, new.fly_pattern,
    new.fly_size, new.fly_color, new.presentation_method, new.conditions_snapshot_id, new.note,
    tf, tsess, tplan, tstart, tend, tst
  )
  on conflict (id) do update set
    location_id = excluded.location_id,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    timestamp = excluded.timestamp,
    species = excluded.species,
    size_inches = excluded.size_inches,
    quantity = excluded.quantity,
    released = excluded.released,
    depth_ft = excluded.depth_ft,
    structure = excluded.structure,
    caught_on_fly = excluded.caught_on_fly,
    fly_pattern = excluded.fly_pattern,
    fly_size = excluded.fly_size,
    fly_color = excluded.fly_color,
    presentation_method = excluded.presentation_method,
    conditions_snapshot_id = excluded.conditions_snapshot_id,
    note = excluded.note,
    trip_fishing_type = excluded.trip_fishing_type,
    trip_session_type = excluded.trip_session_type,
    trip_planned_date = excluded.trip_planned_date,
    trip_start_time = excluded.trip_start_time,
    trip_end_time = excluded.trip_end_time,
    trip_status = excluded.trip_status;
  return new;
end;
$$;

-- Trips: hide soft-deleted from normal reads; only active rows updatable.
drop policy if exists "Users can view own trips" on public.trips;
create policy "Users can view own trips"
  on public.trips for select
  using (auth.uid() = user_id and deleted_at is null);

drop policy if exists "Users can update own trips" on public.trips;
create policy "Users can update own trips"
  on public.trips for update
  using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id);

-- trip_events: only for non-deleted trips
drop policy if exists "Users can view own trip events" on public.trip_events;
create policy "Users can view own trip events"
  on public.trip_events for select
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_events.trip_id and t.user_id = auth.uid() and t.deleted_at is null
    )
  );

drop policy if exists "Users can insert own trip events" on public.trip_events;
create policy "Users can insert own trip events"
  on public.trip_events for insert
  with check (
    exists (
      select 1 from public.trips t
      where t.id = trip_events.trip_id and t.user_id = auth.uid() and t.deleted_at is null
    )
  );

drop policy if exists "Users can update own trip events" on public.trip_events;
create policy "Users can update own trip events"
  on public.trip_events for update
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_events.trip_id and t.user_id = auth.uid() and t.deleted_at is null
    )
  );

drop policy if exists "Users can delete own trip events" on public.trip_events;
create policy "Users can delete own trip events"
  on public.trip_events for delete
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_events.trip_id and t.user_id = auth.uid()
    )
  );

-- Photos / catches: hide soft-deleted
drop policy if exists "Users can view own photos" on public.photos;
create policy "Users can view own photos"
  on public.photos for select
  using (auth.uid() = user_id and deleted_at is null);

drop policy if exists "Users can insert own photos" on public.photos;
create policy "Users can insert own photos"
  on public.photos for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own photos" on public.photos;
create policy "Users can update own photos"
  on public.photos for update
  using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own photos" on public.photos;
create policy "Users can delete own photos"
  on public.photos for delete
  using (auth.uid() = user_id);

drop policy if exists "Users can view own catches" on public.catches;
create policy "Users can view own catches"
  on public.catches for select
  using (auth.uid() = user_id and deleted_at is null);

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

-- Block profile edits after account closure (RPC bypasses RLS).
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id and account_deleted_at is null)
  with check (auth.uid() = id);

create or replace function public.soft_delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.community_catches cc
  using public.catches c
  where cc.id = c.id and c.user_id = uid;

  update public.catches
  set deleted_at = now()
  where user_id = uid and deleted_at is null;

  update public.photos
  set deleted_at = now()
  where user_id = uid and deleted_at is null;

  update public.trips
  set deleted_at = now()
  where user_id = uid and deleted_at is null;

  update public.locations
  set deleted_at = now(), deleted_by = uid
  where created_by = uid and deleted_at is null;

  delete from public.user_fly_box where user_id = uid;

  delete from public.guide_intel_usage where user_id = uid;

  delete from public.access_points
  where created_by = uid and status = 'pending'::access_point_status;

  update public.profiles
  set
    account_deleted_at = now(),
    avatar_url = null,
    first_name = null,
    last_name = null,
    home_state = null,
    display_name = 'Deleted account'
  where id = uid;
end;
$$;

revoke all on function public.soft_delete_my_account() from public;
grant execute on function public.soft_delete_my_account() to authenticated;
