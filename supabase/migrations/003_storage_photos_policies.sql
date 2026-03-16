-- RLS policies for the "photos" storage bucket.
-- By default Storage blocks uploads; these policies allow them.
--
-- IMPORTANT: If "supabase db push" / migration fails with
-- "must be owner of table objects", run this entire file in
-- Supabase Dashboard > SQL Editor (Storage runs as a different owner there).

-- Allow authenticated users to upload to their own user_album folder and to trip_photos
create policy "Allow authenticated uploads to photos bucket"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'photos'
  and (
    (
      (storage.foldername(name))[1] = 'user_album'
      and (storage.foldername(name))[2] = (select auth.jwt()->>'sub')
    )
    or (storage.foldername(name))[1] = 'trip_photos'
  )
);

-- Allow anyone to read (required for public image URLs to work)
create policy "Allow public read photos bucket"
on storage.objects
for select
to public
using (bucket_id = 'photos');
