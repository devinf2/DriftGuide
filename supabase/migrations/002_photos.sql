-- Photos feature: user album (home) and trip photos.
-- Storage: Create a bucket named "photos" in Supabase Dashboard > Storage (public) so uploads work.

-- User photo album (home page)
create table user_album_photos (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  url text not null,
  caption text,
  created_at timestamptz default now()
);

alter table user_album_photos enable row level security;
create policy "Users can view own album photos" on user_album_photos for select using (auth.uid() = user_id);
create policy "Users can insert own album photos" on user_album_photos for insert with check (auth.uid() = user_id);
create policy "Users can delete own album photos" on user_album_photos for delete using (auth.uid() = user_id);

create index idx_user_album_photos_user_id on user_album_photos(user_id);
create index idx_user_album_photos_created_at on user_album_photos(created_at desc);

-- Trip photos (within a trip)
create table trip_photos (
  id uuid default uuid_generate_v4() primary key,
  trip_id uuid references trips(id) on delete cascade not null,
  url text not null,
  caption text,
  created_at timestamptz default now()
);

alter table trip_photos enable row level security;
create policy "Users can view own trip photos" on trip_photos for select
  using (exists (select 1 from trips where trips.id = trip_photos.trip_id and trips.user_id = auth.uid()));
create policy "Users can insert own trip photos" on trip_photos for insert
  with check (exists (select 1 from trips where trips.id = trip_photos.trip_id and trips.user_id = auth.uid()));
create policy "Users can delete own trip photos" on trip_photos for delete
  using (exists (select 1 from trips where trips.id = trip_photos.trip_id and trips.user_id = auth.uid()));

create index idx_trip_photos_trip_id on trip_photos(trip_id);
create index idx_trip_photos_created_at on trip_photos(created_at desc);
