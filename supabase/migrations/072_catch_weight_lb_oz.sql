-- Fish weight: whole pounds + ounces (0–15) on catches and anonymized community copy.

alter table public.catches
  add column if not exists weight_lb integer,
  add column if not exists weight_oz smallint;

comment on column public.catches.weight_lb is 'Whole pounds portion of fish weight (with weight_oz 0–15).';
comment on column public.catches.weight_oz is 'Ounces 0–15; combined with weight_lb for total weight.';

alter table public.community_catches
  add column if not exists weight_lb integer,
  add column if not exists weight_oz smallint;

alter table public.catches
  drop constraint if exists catches_weight_oz_range;

alter table public.catches
  add constraint catches_weight_oz_range
  check (weight_oz is null or (weight_oz >= 0 and weight_oz < 16));

-- Keep community trigger in sync (from 044_soft_delete_account + trip context).
create or replace function public.sync_community_catch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tf text;
  tsess text;
  tplan timestamptz;
  tstart timestamptz;
  tend timestamptz;
  tst text;
begin
  if new.deleted_at is not null then
    delete from public.community_catches where id = new.id;
    return new;
  end if;

  select
    t.fishing_type::text,
    t.session_type,
    t.planned_date,
    t.start_time,
    t.end_time,
    t.status::text
  into tf, tsess, tplan, tstart, tend, tst
  from public.trips t
  where t.id = new.trip_id;

  insert into public.community_catches (
    id, location_id, latitude, longitude, timestamp, species, size_inches, quantity, released,
    depth_ft, structure, caught_on_fly, fly_pattern, fly_size, fly_color, presentation_method,
    conditions_snapshot_id, note,
    trip_fishing_type, trip_session_type, trip_planned_date, trip_start_time, trip_end_time, trip_status,
    weight_lb, weight_oz
  ) values (
    new.id, new.location_id, new.latitude, new.longitude, new.timestamp, new.species, new.size_inches,
    new.quantity, new.released, new.depth_ft, new.structure, new.caught_on_fly, new.fly_pattern,
    new.fly_size, new.fly_color, new.presentation_method, new.conditions_snapshot_id, new.note,
    tf, tsess, tplan, tstart, tend, tst,
    new.weight_lb, new.weight_oz
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
    trip_status = excluded.trip_status,
    weight_lb = excluded.weight_lb,
    weight_oz = excluded.weight_oz;
  return new;
end;
$$;

-- batch_import_trips (current shape from 040_trips_active_fishing_ms.sql)
create or replace function batch_import_trips(
  p_trips jsonb,
  p_events jsonb,
  p_conditions jsonb,
  p_catches jsonb,
  p_photos jsonb
) returns void
language plpgsql security definer
as $$
begin
  insert into trips (
    id, user_id, location_id, access_point_id, status, fishing_type,
    planned_date, start_time, end_time, total_fish, notes,
    ai_recommendation_cache, weather_cache, water_flow_cache,
    start_latitude, start_longitude, end_latitude, end_longitude,
    session_type, rating, user_reported_clarity, imported, active_fishing_ms
  )
  select
    (r->>'id')::uuid,
    (r->>'user_id')::uuid,
    (r->>'location_id')::uuid,
    (r->>'access_point_id')::uuid,
    (r->>'status')::trip_status,
    (r->>'fishing_type')::fishing_type,
    (r->>'planned_date')::timestamptz,
    (r->>'start_time')::timestamptz,
    (r->>'end_time')::timestamptz,
    (r->>'total_fish')::integer,
    r->>'notes',
    coalesce(r->'ai_recommendation_cache', '{}'::jsonb),
    coalesce(r->'weather_cache', '{}'::jsonb),
    coalesce(r->'water_flow_cache', '{}'::jsonb),
    (r->>'start_latitude')::double precision,
    (r->>'start_longitude')::double precision,
    (r->>'end_latitude')::double precision,
    (r->>'end_longitude')::double precision,
    r->>'session_type',
    (r->>'rating')::smallint,
    r->>'user_reported_clarity',
    coalesce((r->>'imported')::boolean, false),
    (r->>'active_fishing_ms')::bigint
  from jsonb_array_elements(p_trips) as r
  on conflict (id) do update set
    location_id        = excluded.location_id,
    access_point_id    = excluded.access_point_id,
    status             = excluded.status,
    fishing_type       = excluded.fishing_type,
    planned_date       = excluded.planned_date,
    start_time         = excluded.start_time,
    end_time           = excluded.end_time,
    total_fish         = excluded.total_fish,
    notes              = excluded.notes,
    ai_recommendation_cache = excluded.ai_recommendation_cache,
    weather_cache      = excluded.weather_cache,
    water_flow_cache   = excluded.water_flow_cache,
    start_latitude     = excluded.start_latitude,
    start_longitude    = excluded.start_longitude,
    end_latitude       = excluded.end_latitude,
    end_longitude      = excluded.end_longitude,
    session_type       = excluded.session_type,
    rating             = excluded.rating,
    user_reported_clarity = excluded.user_reported_clarity,
    imported           = excluded.imported,
    active_fishing_ms  = excluded.active_fishing_ms;

  insert into trip_events (
    id, trip_id, event_type, timestamp, data, conditions_snapshot, latitude, longitude
  )
  select
    (r->>'id')::uuid,
    (r->>'trip_id')::uuid,
    (r->>'event_type')::event_type,
    (r->>'timestamp')::timestamptz,
    coalesce(r->'data', '{}'::jsonb),
    r->'conditions_snapshot',
    (r->>'latitude')::double precision,
    (r->>'longitude')::double precision
  from jsonb_array_elements(p_events) as r
  on conflict (id) do update set
    data                = excluded.data,
    conditions_snapshot = excluded.conditions_snapshot,
    latitude            = excluded.latitude,
    longitude           = excluded.longitude;

  insert into conditions_snapshots (
    id,
    temperature_f, condition, cloud_cover, wind_speed_mph, wind_direction,
    barometric_pressure, humidity,
    flow_station_id, flow_station_name, flow_cfs, water_temp_f,
    gage_height_ft, turbidity_ntu, flow_clarity, flow_clarity_source, flow_timestamp,
    moon_phase, captured_at
  )
  select
    (r->>'id')::uuid,
    (r->>'temperature_f')::integer,
    r->>'condition',
    (r->>'cloud_cover')::integer,
    (r->>'wind_speed_mph')::numeric(5,2),
    r->>'wind_direction',
    (r->>'barometric_pressure')::numeric(6,2),
    (r->>'humidity')::integer,
    r->>'flow_station_id',
    r->>'flow_station_name',
    (r->>'flow_cfs')::numeric(12,2),
    (r->>'water_temp_f')::numeric(5,2),
    (r->>'gage_height_ft')::numeric(6,2),
    (r->>'turbidity_ntu')::numeric(8,2),
    r->>'flow_clarity',
    r->>'flow_clarity_source',
    (r->>'flow_timestamp')::timestamptz,
    r->>'moon_phase',
    coalesce((r->>'captured_at')::timestamptz, now())
  from jsonb_array_elements(p_conditions) as r
  on conflict (id) do nothing;

  insert into catches (
    id, user_id, trip_id, event_id, location_id, access_point_id,
    latitude, longitude, timestamp,
    species, size_inches, quantity, released, depth_ft, structure,
    caught_on_fly, active_fly_event_id, presentation_method, note,
    photo_url, conditions_snapshot_id,
    fly_pattern, fly_size, fly_color,
    weight_lb, weight_oz
  )
  select
    (r->>'id')::uuid,
    (r->>'user_id')::uuid,
    (r->>'trip_id')::uuid,
    (r->>'event_id')::uuid,
    (r->>'location_id')::uuid,
    (r->>'access_point_id')::uuid,
    (r->>'latitude')::double precision,
    (r->>'longitude')::double precision,
    (r->>'timestamp')::timestamptz,
    r->>'species',
    (r->>'size_inches')::numeric(5,2),
    coalesce((r->>'quantity')::integer, 1),
    (r->>'released')::boolean,
    (r->>'depth_ft')::numeric(6,2),
    r->>'structure',
    r->>'caught_on_fly',
    (r->>'active_fly_event_id')::uuid,
    r->>'presentation_method',
    r->>'note',
    r->>'photo_url',
    (r->>'conditions_snapshot_id')::uuid,
    r->>'fly_pattern',
    (r->>'fly_size')::integer,
    r->>'fly_color',
    (r->>'weight_lb')::integer,
    (r->>'weight_oz')::smallint
  from jsonb_array_elements(p_catches) as r
  on conflict (id) do update set
    location_id            = excluded.location_id,
    access_point_id        = excluded.access_point_id,
    latitude               = excluded.latitude,
    longitude              = excluded.longitude,
    timestamp              = excluded.timestamp,
    species                = excluded.species,
    size_inches            = excluded.size_inches,
    quantity               = excluded.quantity,
    released               = excluded.released,
    depth_ft               = excluded.depth_ft,
    structure              = excluded.structure,
    caught_on_fly          = excluded.caught_on_fly,
    active_fly_event_id    = excluded.active_fly_event_id,
    presentation_method    = excluded.presentation_method,
    note                   = excluded.note,
    photo_url              = excluded.photo_url,
    conditions_snapshot_id = excluded.conditions_snapshot_id,
    fly_pattern            = excluded.fly_pattern,
    fly_size               = excluded.fly_size,
    fly_color              = excluded.fly_color,
    weight_lb              = excluded.weight_lb,
    weight_oz              = excluded.weight_oz;

  insert into photos (
    user_id, trip_id, url, catch_id, display_order, caption,
    species, fly_pattern, fly_size, fly_color, captured_at
  )
  select
    (r->>'user_id')::uuid,
    (r->>'trip_id')::uuid,
    r->>'url',
    (r->>'catch_id')::uuid,
    coalesce((r->>'display_order')::smallint, 0),
    r->>'caption',
    r->>'species',
    r->>'fly_pattern',
    r->>'fly_size',
    r->>'fly_color',
    (r->>'captured_at')::timestamptz
  from jsonb_array_elements(p_photos) as r;
end;
$$;

update public.community_catches cc set
  weight_lb = c.weight_lb,
  weight_oz = c.weight_oz
from public.catches c
where cc.id = c.id;
