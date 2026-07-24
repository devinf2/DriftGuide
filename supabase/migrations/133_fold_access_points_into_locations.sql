-- Fold `access_points` into the `locations` tree.
--
-- Access points are now child `locations` rows (type 'access_point',
-- parent_location_id = the water). This unifies the two competing "access point"
-- models onto one hierarchy — the same tree guides (guide_waters /
-- guide_services.location_id), hatches, and fly predictions already read from.
--
-- Strategy (deliberately conservative / reversible-ish):
--   * COPY each access_points row into `locations`, PRESERVING its id. Because the
--     id is preserved, existing trips.access_point_id / catches.access_point_id keep
--     pointing at the right row after we retarget those FKs to locations(id).
--   * We do NOT drop `access_points` here. It is left in place (deprecated) so
--     already-released app versions and the account-deletion edge function keep
--     working during rollout. A later migration drops it once old clients are gone.
--
-- Moderation maps onto locations' visibility model:
--   approved -> status 'verified', is_public true   (public, everyone sees it)
--   pending  -> status 'pending',  is_public false  (creator-only, as before)

begin;

-- 1. Copy access points into the locations tree, preserving ids. Skip any id that
--    somehow already exists as a location (defensive; uuids will not collide).
insert into locations (
  id, name, type, parent_location_id, latitude, longitude,
  metadata, created_by, status, usage_count, is_public, created_at
)
select
  ap.id,
  ap.name,
  'access_point'::location_type,
  ap.location_id,
  ap.latitude,
  ap.longitude,
  '{}'::jsonb,
  ap.created_by,
  case when ap.status = 'approved' then 'verified' else 'pending' end,
  0,
  (ap.status = 'approved'),
  ap.created_at
from access_points ap
where not exists (select 1 from locations l where l.id = ap.id);

-- 2. Retarget the trips.access_point_id FK from access_points(id) to locations(id).
--    Ids were preserved above, so existing values are already valid — no data update
--    needed. Drop any FK from trips that references access_points, then re-add to locations.
do $$
declare
  con text;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'trips'::regclass
      and contype = 'f'
      and confrelid = 'access_points'::regclass
  loop
    execute format('alter table trips drop constraint %I', con);
  end loop;
end $$;

alter table trips
  add constraint trips_access_point_id_fkey
  foreign key (access_point_id) references locations(id) on delete set null;

-- 3. Same for catches.access_point_id.
do $$
declare
  con text;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'catches'::regclass
      and contype = 'f'
      and confrelid = 'access_points'::regclass
  loop
    execute format('alter table catches drop constraint %I', con);
  end loop;
end $$;

alter table catches
  add constraint catches_access_point_id_fkey
  foreign key (access_point_id) references locations(id) on delete set null;

-- 4. Mark the old table deprecated (kept for backward-compat during rollout).
comment on table access_points is
  'DEPRECATED: folded into locations (type=access_point). Kept for old clients; drop in a later migration.';

commit;
