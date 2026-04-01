-- Profile photo URL (public object in existing "photos" bucket: photos/{user_id}/profile-*.ext)
alter table profiles add column if not exists avatar_url text;

comment on column profiles.avatar_url is 'Public storage URL for profile image';

-- Replace/delete own objects under photos/{user_id}/ (needed to swap avatar files)
drop policy if exists "Allow authenticated update own photos folder" on storage.objects;
create policy "Allow authenticated update own photos folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = 'photos'
  and (storage.foldername(name))[2] = (select auth.jwt()->>'sub')
)
with check (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = 'photos'
  and (storage.foldername(name))[2] = (select auth.jwt()->>'sub')
);

drop policy if exists "Allow authenticated delete own photos folder" on storage.objects;
create policy "Allow authenticated delete own photos folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = 'photos'
  and (storage.foldername(name))[2] = (select auth.jwt()->>'sub')
);
