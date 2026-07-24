-- Optionally tie a business to a specific water. When set, the business surfaces
-- on that location's Report ("Local shops") in addition to proximity matches.
-- Nullable: most shops just fall in by distance; tagging is for shops that clearly
-- belong to a water (a fly shop on the Provo, a lodge on the Green).

alter table businesses
  add column if not exists location_id uuid references locations(id) on delete set null;

create index if not exists idx_businesses_location_id on businesses(location_id);
