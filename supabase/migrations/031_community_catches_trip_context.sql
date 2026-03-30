-- Denormalize non-identifying trip context onto community_catches for offline / AI context.
alter table community_catches add column if not exists trip_fishing_type text;
alter table community_catches add column if not exists trip_session_type text;
alter table community_catches add column if not exists trip_planned_date timestamptz;
alter table community_catches add column if not exists trip_start_time timestamptz;
alter table community_catches add column if not exists trip_end_time timestamptz;
alter table community_catches add column if not exists trip_status text;

create or replace function sync_community_catch()
returns trigger as $$
declare
  tf text;
  tsess text;
  tplan timestamptz;
  tstart timestamptz;
  tend timestamptz;
  tst text;
begin
  select
    t.fishing_type::text,
    t.session_type,
    t.planned_date,
    t.start_time,
    t.end_time,
    t.status::text
  into tf, tsess, tplan, tstart, tend, tst
  from trips t
  where t.id = new.trip_id;

  insert into community_catches (
    id, location_id, latitude, longitude, timestamp, species, size_inches, quantity, released,
    depth_ft, structure, caught_on_fly, fly_pattern, fly_size, fly_color, presentation_method,
    conditions_snapshot_id, note,
    trip_fishing_type, trip_session_type, trip_planned_date, trip_start_time, trip_end_time, trip_status
  ) values (
    new.id, new.location_id, new.latitude, new.longitude, new.timestamp, new.species, new.size_inches,
    new.quantity, new.released, new.depth_ft, new.structure, new.caught_on_fly, new.fly_pattern,
    new.fly_size, new.fly_color, new.presentation_method, new.conditions_snapshot_id, new.note,
    tf, tsess, tplan, tstart, tend, tst
  )
  on conflict (id) do update set
    location_id = excluded.location_id,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    timestamp = excluded.timestamp,
    species = excluded.species,
    size_inches = excluded.size_inches,
    quantity = excluded.quantity,
    released = excluded.released,
    depth_ft = excluded.depth_ft,
    structure = excluded.structure,
    caught_on_fly = excluded.caught_on_fly,
    fly_pattern = excluded.fly_pattern,
    fly_size = excluded.fly_size,
    fly_color = excluded.fly_color,
    presentation_method = excluded.presentation_method,
    conditions_snapshot_id = excluded.conditions_snapshot_id,
    note = excluded.note,
    trip_fishing_type = excluded.trip_fishing_type,
    trip_session_type = excluded.trip_session_type,
    trip_planned_date = excluded.trip_planned_date,
    trip_start_time = excluded.trip_start_time,
    trip_end_time = excluded.trip_end_time,
    trip_status = excluded.trip_status;
  return new;
end;
$$ language plpgsql security definer;

-- Backfill from trips via catches (community_catches.id = catches.id).
update community_catches cc set
  trip_fishing_type = t.fishing_type::text,
  trip_session_type = t.session_type,
  trip_planned_date = t.planned_date,
  trip_start_time = t.start_time,
  trip_end_time = t.end_time,
  trip_status = t.status::text
from catches c
join trips t on t.id = c.trip_id
where cc.id = c.id;
