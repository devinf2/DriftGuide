-- Single photos table with optional tie-ins: trip, species, fly, time.
-- Date/location are derived from trip when trip_id is set.
-- Album = all user photos (trip_id optional). From trip we save trip_id + whatever we have.

create table if not exists photos (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  trip_id uuid references trips(id) on delete set null,
  url text not null,
  caption text,
  species text,
  fly_pattern text,
  captured_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table photos enable row level security;

drop policy if exists "Users can view own photos" on photos;
create policy "Users can view own photos"
  on photos for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own photos" on photos;
create policy "Users can insert own photos"
  on photos for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own photos" on photos;
create policy "Users can update own photos"
  on photos for update using (auth.uid() = user_id);

drop policy if exists "Users can delete own photos" on photos;
create policy "Users can delete own photos"
  on photos for delete using (auth.uid() = user_id);

create index idx_photos_user_id on photos(user_id);
create index idx_photos_trip_id on photos(trip_id);
create index idx_photos_created_at on photos(created_at desc);
create index idx_photos_captured_at on photos(captured_at desc nulls last);

-- Migrate existing data (run only if old tables exist). New ids to avoid conflicts.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'user_album_photos') then
    insert into photos (user_id, trip_id, url, caption, captured_at, created_at)
    select user_id, null, url, caption, created_at, created_at from user_album_photos;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'trip_photos') then
    insert into photos (user_id, trip_id, url, caption, captured_at, created_at)
    select t.user_id, tp.trip_id, tp.url, tp.caption, tp.created_at, tp.created_at
    from trip_photos tp
    join trips t on t.id = tp.trip_id;
  end if;
end $$;

drop table if exists trip_photos;
drop table if exists user_album_photos;
