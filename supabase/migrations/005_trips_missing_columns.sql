-- Ensure trips has planned_date and water_flow_cache (fixes PGRST204 if 002/003 weren't run)
alter table trips add column if not exists planned_date timestamptz;
alter table trips add column if not exists water_flow_cache jsonb default '{}'::jsonb;
