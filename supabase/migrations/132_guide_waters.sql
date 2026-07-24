-- Guide ↔ water linkage (the "Waters I guide" multi-select on the guide profile).
--
-- Discovery previously keyed only off guide_services.location_id — a guide was
-- findable on a water only if they had an offering tagged to it. This lets a
-- guide declare the waters they run independently of offerings; fetchGuidesFor
-- Location unions both sources so either path makes a guide discoverable.
--
-- Visibility mirrors guide_services: rows are public once the guide is approved,
-- and always visible to the owner and admins. Writes are owner/admin only.

create table guide_waters (
  guide_id uuid not null references guide_profiles(profile_id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (guide_id, location_id)
);

-- Discovery looks up guides by water, so index the location side.
create index idx_guide_waters_location_id on guide_waters(location_id);

alter table guide_waters enable row level security;

create policy "guide_waters_select_visible" on guide_waters for select
  using (
    guide_id = auth.uid()
    or is_admin()
    or exists (select 1 from guide_profiles g where g.profile_id = guide_id and g.status = 'approved')
  );

create policy "guide_waters_write_own_or_admin" on guide_waters for all
  using (guide_id = auth.uid() or is_admin())
  with check (guide_id = auth.uid() or is_admin());
