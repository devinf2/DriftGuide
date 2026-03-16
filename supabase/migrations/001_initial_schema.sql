-- DriftGuide Initial Schema

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- Custom types
create type fishing_type as enum ('fly', 'bait', 'spin');
create type trip_status as enum ('active', 'completed', 'planned');
create type event_type as enum ('fly_change', 'catch', 'note', 'location_move', 'ai_query', 'ai_response');
create type location_type as enum ('river', 'lake', 'reservoir', 'stream', 'pond');
create type fly_type as enum ('fly', 'bait', 'lure');

-- Profiles (extends Supabase auth.users)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text,
  preferred_fishing_type fishing_type default 'fly',
  created_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);

-- Locations
create table locations (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  type location_type not null,
  parent_location_id uuid references locations(id),
  latitude double precision,
  longitude double precision,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table locations enable row level security;
create policy "Locations are viewable by all authenticated users" on locations for select using (auth.role() = 'authenticated');
create policy "Locations can be inserted by authenticated users" on locations for insert with check (auth.role() = 'authenticated');

-- Trips
create table trips (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  location_id uuid references locations(id),
  status trip_status default 'planned' not null,
  fishing_type fishing_type default 'fly' not null,
  start_time timestamptz,
  end_time timestamptz,
  total_fish integer default 0,
  notes text,
  ai_recommendation_cache jsonb default '{}'::jsonb,
  weather_cache jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table trips enable row level security;
create policy "Users can view own trips" on trips for select using (auth.uid() = user_id);
create policy "Users can insert own trips" on trips for insert with check (auth.uid() = user_id);
create policy "Users can update own trips" on trips for update using (auth.uid() = user_id);
create policy "Users can delete own trips" on trips for delete using (auth.uid() = user_id);

create index idx_trips_user_id on trips(user_id);
create index idx_trips_status on trips(status);
create index idx_trips_start_time on trips(start_time desc);

-- Trip Events
create table trip_events (
  id uuid default uuid_generate_v4() primary key,
  trip_id uuid references trips(id) on delete cascade not null,
  event_type event_type not null,
  timestamp timestamptz default now() not null,
  data jsonb default '{}'::jsonb,
  latitude double precision,
  longitude double precision,
  created_at timestamptz default now()
);

alter table trip_events enable row level security;
create policy "Users can view own trip events" on trip_events for select
  using (exists (select 1 from trips where trips.id = trip_events.trip_id and trips.user_id = auth.uid()));
create policy "Users can insert own trip events" on trip_events for insert
  with check (exists (select 1 from trips where trips.id = trip_events.trip_id and trips.user_id = auth.uid()));
create policy "Users can update own trip events" on trip_events for update
  using (exists (select 1 from trips where trips.id = trip_events.trip_id and trips.user_id = auth.uid()));
create policy "Users can delete own trip events" on trip_events for delete
  using (exists (select 1 from trips where trips.id = trip_events.trip_id and trips.user_id = auth.uid()));

create index idx_trip_events_trip_id on trip_events(trip_id);
create index idx_trip_events_timestamp on trip_events(timestamp);
create index idx_trip_events_type on trip_events(event_type);

-- Flies (user's fly/bait/lure library)
create table flies (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  type fly_type default 'fly' not null,
  size integer,
  color text,
  photo_url text,
  use_count integer default 0,
  created_at timestamptz default now()
);

alter table flies enable row level security;
create policy "Users can view own flies" on flies for select using (auth.uid() = user_id);
create policy "Users can insert own flies" on flies for insert with check (auth.uid() = user_id);
create policy "Users can update own flies" on flies for update using (auth.uid() = user_id);
create policy "Users can delete own flies" on flies for delete using (auth.uid() = user_id);

create index idx_flies_user_id on flies(user_id);

-- Seed locations (Utah fishing spots)
-- baseline_flow_cfs = median annual discharge for relative flow status (green/yellow/red)
insert into locations (name, type, latitude, longitude, metadata) values
  ('Provo River', 'river', 40.3416, -111.6127, '{"usgs_station_id": "10163000", "baseline_flow_cfs": 150}'),
  ('Strawberry Reservoir', 'reservoir', 40.1716, -111.1463, '{}'),
  ('Green River', 'river', 40.9088, -109.4226, '{"usgs_station_id": "09261000", "baseline_flow_cfs": 1800}'),
  ('Weber River', 'river', 40.8622, -111.3929, '{"usgs_station_id": "10128500", "baseline_flow_cfs": 250}'),
  ('Logan River', 'river', 41.7355, -111.8047, '{"usgs_station_id": "10109000", "baseline_flow_cfs": 160}'),
  ('Ogden River', 'river', 41.2230, -111.9738, '{}'),
  ('Bear Lake', 'lake', 41.9483, -111.3192, '{}'),
  ('Flaming Gorge Reservoir', 'reservoir', 40.9147, -109.4221, '{}'),
  ('Jordanelle Reservoir', 'reservoir', 40.6022, -111.4236, '{}'),
  ('Deer Creek Reservoir', 'reservoir', 40.4097, -111.5222, '{}');

-- Seed sub-locations (river sections)
insert into locations (name, type, parent_location_id, latitude, longitude, metadata)
select 'Upper Provo', 'river', id, 40.5613, -111.1367, '{"section": "upper"}'
from locations where name = 'Provo River';

insert into locations (name, type, parent_location_id, latitude, longitude, metadata)
select 'Middle Provo', 'river', id, 40.3416, -111.6127, '{"section": "middle"}'
from locations where name = 'Provo River';

insert into locations (name, type, parent_location_id, latitude, longitude, metadata)
select 'Lower Provo', 'river', id, 40.2460, -111.6615, '{"section": "lower"}'
from locations where name = 'Provo River';

insert into locations (name, type, parent_location_id, latitude, longitude, metadata)
select 'Strawberry Bay', 'reservoir', id, 40.1716, -111.1463, '{}'
from locations where name = 'Strawberry Reservoir';

insert into locations (name, type, parent_location_id, latitude, longitude, metadata)
select 'Mud Creek', 'reservoir', id, 40.1575, -111.0993, '{}'
from locations where name = 'Strawberry Reservoir';

insert into locations (name, type, parent_location_id, latitude, longitude, metadata)
select 'Soldier Creek', 'reservoir', id, 40.1328, -111.1008, '{}'
from locations where name = 'Strawberry Reservoir';

-- Function to auto-create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Angler'));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
