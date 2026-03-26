-- Optional visibility for user-created locations (default: visible to everyone).

alter table public.locations
  add column if not exists is_public boolean not null default true;

comment on column public.locations.is_public is 'When false, only the creator can see this row (select RLS).';

drop policy if exists "Locations are viewable by all authenticated users" on public.locations;

create policy "Locations viewable when public or owned"
  on public.locations
  for select
  to authenticated
  using (coalesce(is_public, true) = true or created_by = auth.uid());
