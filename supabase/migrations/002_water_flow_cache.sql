-- Add water_flow_cache column to trips for persisting water conditions in journal
alter table trips add column if not exists water_flow_cache jsonb default '{}'::jsonb;

-- Backfill baseline_flow_cfs into existing locations that have USGS stations
update locations set metadata = jsonb_set(metadata, '{baseline_flow_cfs}', '150')
  where name = 'Provo River' and metadata->>'usgs_station_id' is not null;

update locations set metadata = jsonb_set(metadata, '{baseline_flow_cfs}', '1800')
  where name = 'Green River' and metadata->>'usgs_station_id' is not null;

update locations set metadata = jsonb_set(metadata, '{baseline_flow_cfs}', '250')
  where name = 'Weber River' and metadata->>'usgs_station_id' is not null;

update locations set metadata = jsonb_set(metadata, '{baseline_flow_cfs}', '160')
  where name = 'Logan River' and metadata->>'usgs_station_id' is not null;
