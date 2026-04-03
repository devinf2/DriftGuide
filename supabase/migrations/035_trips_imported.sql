-- Past-trip imports are not real timed sessions; UI shows duration as "Imported".
alter table public.trips
  add column if not exists imported boolean not null default false;

comment on column public.trips.imported is 'True when the trip was created via Import Past Trips (not a live session).';
