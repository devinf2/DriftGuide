-- Fix: Ensure user_album_photos SELECT policy exists so "Refresh" returns your photos.
-- Run this in Supabase Dashboard > SQL Editor if the album stays empty after Refresh.

drop policy if exists "Users can view own album photos" on user_album_photos;
create policy "Users can view own album photos"
  on user_album_photos for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own album photos" on user_album_photos;
create policy "Users can insert own album photos"
  on user_album_photos for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own album photos" on user_album_photos;
create policy "Users can delete own album photos"
  on user_album_photos for delete
  using (auth.uid() = user_id);
