-- User-specific fly photos (catalog photo_url remains for reference/seed images).

alter table user_fly_box add column if not exists photo_url text;
