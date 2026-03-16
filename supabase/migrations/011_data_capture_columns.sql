-- Data capture for exit strategy: trip-level GPS, session type, rating, user-reported clarity.
-- Catch-level fields (quantity, depth_ft, presentation_method, released, structure) live in trip_events.data jsonb.

alter table trips add column if not exists start_latitude double precision;
alter table trips add column if not exists start_longitude double precision;
alter table trips add column if not exists end_latitude double precision;
alter table trips add column if not exists end_longitude double precision;
alter table trips add column if not exists session_type text;
alter table trips add column if not exists rating smallint;
alter table trips add column if not exists user_reported_clarity text;

comment on column trips.start_latitude is 'GPS latitude at trip start';
comment on column trips.start_longitude is 'GPS longitude at trip start';
comment on column trips.end_latitude is 'GPS latitude at trip end';
comment on column trips.end_longitude is 'GPS longitude at trip end';
comment on column trips.session_type is 'wade | float | shore';
comment on column trips.rating is '1-5 stars from post-trip survey';
comment on column trips.user_reported_clarity is 'User-reported water clarity: clear | slightly_stained | stained | murky | blown_out';
