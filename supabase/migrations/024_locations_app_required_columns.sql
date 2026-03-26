-- Columns required by the mobile app when inserting community locations.
-- Safe to run if 002_community_locations / 022 were skipped or only partially applied.
-- After applying: in Supabase Dashboard → Settings → API → "Reload schema" if inserts still fail.

alter table public.locations add column if not exists created_by uuid references public.profiles(id);
alter table public.locations add column if not exists usage_count integer default 0;
alter table public.locations add column if not exists status text default 'verified';
alter table public.locations add column if not exists is_public boolean not null default true;

comment on column public.locations.created_by is 'User who submitted this row (community locations).';
comment on column public.locations.is_public is 'When false, only the creator should see this row (use with RLS).';
