-- Conditions snapshots: normalized table for per-catch conditions (weather, flow, moon).
-- Referenced by catches so we can query and bundle for offline AI.
create table conditions_snapshots (
  id uuid default uuid_generate_v4() primary key,
  -- weather (nullable)
  temperature_f integer,
  condition text,
  cloud_cover integer,
  wind_speed_mph numeric(5,2),
  wind_direction text,
  barometric_pressure numeric(6,2),
  humidity integer,
  -- water flow (nullable)
  flow_station_id text,
  flow_station_name text,
  flow_cfs numeric(12,2),
  water_temp_f numeric(5,2),
  gage_height_ft numeric(6,2),
  turbidity_ntu numeric(8,2),
  flow_clarity text,
  flow_clarity_source text,
  flow_timestamp timestamptz,
  -- other
  moon_phase text,
  captured_at timestamptz not null default now()
);

alter table conditions_snapshots enable row level security;
create policy "Authenticated can read conditions_snapshots" on conditions_snapshots for select using (auth.role() = 'authenticated');
create policy "Authenticated can insert conditions_snapshots" on conditions_snapshots for insert with check (auth.role() = 'authenticated');

create index idx_conditions_snapshots_captured_at on conditions_snapshots(captured_at);

-- Catches: one row per catch event. id = trip_events.id (1:1 with catch event).
-- Denormalized fly_pattern/fly_size/fly_color for community view (no join to trip_events).
create table catches (
  id uuid primary key references trip_events(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade not null,
  trip_id uuid references trips(id) on delete cascade not null,
  event_id uuid references trip_events(id) on delete cascade not null,
  location_id uuid references locations(id) on delete set null,
  latitude double precision,
  longitude double precision,
  timestamp timestamptz not null,
  species text,
  size_inches numeric(5,2),
  quantity integer not null default 1,
  released boolean,
  depth_ft numeric(6,2),
  structure text,
  caught_on_fly text,
  active_fly_event_id uuid references trip_events(id) on delete set null,
  presentation_method text,
  note text,
  photo_url text,
  conditions_snapshot_id uuid references conditions_snapshots(id) on delete set null,
  fly_pattern text,
  fly_size integer,
  fly_color text,
  created_at timestamptz default now()
);

alter table catches enable row level security;
create policy "Users can view own catches" on catches for select using (auth.uid() = user_id);
create policy "Users can insert own catches" on catches for insert with check (auth.uid() = user_id);
create policy "Users can update own catches" on catches for update using (auth.uid() = user_id);
create policy "Users can delete own catches" on catches for delete using (auth.uid() = user_id);

create index idx_catches_trip_id on catches(trip_id);
create index idx_catches_user_id on catches(user_id);
create index idx_catches_location_id on catches(location_id);
create index idx_catches_species on catches(species);
create index idx_catches_timestamp on catches(timestamp desc);

-- Community catches: anonymized copy for "catches on this river" (no user_id, trip_id, event_id, photo).
-- Populated by trigger so all authenticated users can read aggregated data for offline AI.
create table community_catches (
  id uuid primary key references catches(id) on delete cascade,
  location_id uuid references locations(id) on delete set null,
  latitude double precision,
  longitude double precision,
  timestamp timestamptz not null,
  species text,
  size_inches numeric(5,2),
  quantity integer not null default 1,
  released boolean,
  depth_ft numeric(6,2),
  structure text,
  caught_on_fly text,
  fly_pattern text,
  fly_size integer,
  fly_color text,
  presentation_method text,
  conditions_snapshot_id uuid references conditions_snapshots(id) on delete set null,
  note text
);

alter table community_catches enable row level security;
create policy "Authenticated can read community_catches" on community_catches for select using (auth.role() = 'authenticated');

create index idx_community_catches_location_id on community_catches(location_id);
create index idx_community_catches_species on community_catches(species);
create index idx_community_catches_timestamp on community_catches(timestamp desc);

-- Trigger: sync anonymized row to community_catches on insert/update of catches.
create or replace function sync_community_catch()
returns trigger as $$
begin
  insert into community_catches (
    id, location_id, latitude, longitude, timestamp, species, size_inches, quantity, released,
    depth_ft, structure, caught_on_fly, fly_pattern, fly_size, fly_color, presentation_method,
    conditions_snapshot_id, note
  ) values (
    new.id, new.location_id, new.latitude, new.longitude, new.timestamp, new.species, new.size_inches,
    new.quantity, new.released, new.depth_ft, new.structure, new.caught_on_fly, new.fly_pattern,
    new.fly_size, new.fly_color, new.presentation_method, new.conditions_snapshot_id, new.note
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
    note = excluded.note;
  return new;
end;
$$ language plpgsql security definer;

create trigger catches_sync_community
  after insert or update on catches
  for each row
  execute function sync_community_catch();

-- Trigger: remove community_catches row when catch is deleted (CASCADE on id already does this; this is for clarity).
-- No need: FK on community_catches(id) references catches(id) on delete cascade handles it.
