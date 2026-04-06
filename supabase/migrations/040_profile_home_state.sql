-- Optional US home state for offline catalog filtering (name or 2-letter code in app).
alter table public.profiles
  add column if not exists home_state text;

comment on column public.profiles.home_state is 'User home US state (full name or 2-letter code) for offline location snapshot.';
