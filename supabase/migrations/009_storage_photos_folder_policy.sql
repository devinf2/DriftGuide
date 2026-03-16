-- Allow uploads to photos/{userId}/ (single photos table storage path).
-- Run in Supabase Dashboard > SQL Editor if migration fails (storage schema owner).

create policy "Allow authenticated uploads to photos folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = 'photos'
  and (storage.foldername(name))[2] = (select auth.jwt()->>'sub')
);
