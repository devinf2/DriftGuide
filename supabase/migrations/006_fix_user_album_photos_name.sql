-- Fix: app expects "user_album_photos" (singular user). If you created it as "users_album_photos", rename it.
-- Run this in Supabase Dashboard > SQL Editor.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'users_album_photos'
  ) then
    alter table public.users_album_photos rename to user_album_photos;
  end if;
end $$;
