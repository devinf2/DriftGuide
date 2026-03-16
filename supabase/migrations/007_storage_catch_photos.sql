-- Allow uploads to catch_photos folder (for catch event photos).
drop policy if exists "Allow authenticated uploads to photos bucket" on storage.objects;

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
    or (storage.foldername(name))[1] = 'catch_photos'
  )
);
