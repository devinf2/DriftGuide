-- Add conditions_snapshot to trip_events for per-event historical conditions tracking
alter table trip_events
  add column conditions_snapshot jsonb default null;
