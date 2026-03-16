-- 1) Single storage path: only allow photos/{userId}/. Drop legacy policy that allowed user_album and trip_photos.
--    You can delete the "user_album" folder in Storage > photos in the Supabase dashboard if desired.
drop policy if exists "Allow authenticated uploads to photos bucket" on storage.objects;

-- 2) Fly as three fields on photos (pattern already exists)
alter table photos
  add column if not exists fly_size text,
  add column if not exists fly_color text;

comment on column photos.fly_pattern is 'Fly pattern/name';
comment on column photos.fly_size is 'Fly size (e.g. 14, 16)';
comment on column photos.fly_color is 'Fly color';