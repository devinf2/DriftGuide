-- Backfill catch timestamps from photo capture time.
--
-- Context: a regression made addCatch stamp catches with a synthetic time clamped to the
-- trip's end_time, collapsing many catches onto the same minute (e.g. all "8:20 PM").
-- The original time was never stored correctly, but for catches WITH photos the photo's
-- `captured_at` (EXIF, or upload time when no EXIF) is a reliable real-time signal.
--
-- Scope: ONLY catches that have at least one linked photo with a non-null captured_at.
-- Photoless catches are intentionally left alone (no trustworthy source).
--
-- Run order:
--   1. Run the DIAGNOSTIC block first and review what would change.
--   2. If it looks right, run the BACKFILL block (wrapped in a transaction).
--
-- Optional scoping: to limit to one user, add to any WHERE below:
--   and te.trip_id in (select id from trips where user_id = '<USER_UUID>')

-- One canonical photo time per catch: the hero photo (lowest display_order),
-- tie-broken by earliest captured_at. (catch_id = trip_events.id = catches.id)
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- DIAGNOSTIC (read-only) — how many rows, and how far off are they?
-- ===========================================================================

with catch_photo_time as (
  select distinct on (p.catch_id)
    p.catch_id    as event_id,
    p.captured_at as photo_time
  from photos p
  where p.catch_id is not null
    and p.captured_at is not null
  order by p.catch_id, p.display_order asc, p.captured_at asc
)
select
  te.trip_id,
  te.id                                                              as event_id,
  te.timestamp                                                       as current_ts,
  cpt.photo_time                                                     as proposed_ts,
  round(extract(epoch from (te.timestamp - cpt.photo_time)) / 60.0)  as drift_minutes
from trip_events te
join catch_photo_time cpt on cpt.event_id = te.id
where te.event_type = 'catch'
  and te.timestamp is distinct from cpt.photo_time
order by abs(extract(epoch from (te.timestamp - cpt.photo_time))) desc;

-- Summary count:
-- with catch_photo_time as ( ... same CTE ... )
-- select count(*) as catches_to_fix
-- from trip_events te
-- join catch_photo_time cpt on cpt.event_id = te.id
-- where te.event_type = 'catch'
--   and te.timestamp is distinct from cpt.photo_time;


-- ===========================================================================
-- BACKFILL — run only after reviewing the diagnostic above.
-- ===========================================================================

begin;

-- 1) Authoritative table used by the Fishing timeline / journal.
with catch_photo_time as (
  select distinct on (p.catch_id)
    p.catch_id    as event_id,
    p.captured_at as photo_time
  from photos p
  where p.catch_id is not null
    and p.captured_at is not null
  order by p.catch_id, p.display_order asc, p.captured_at asc
)
update trip_events te
set timestamp = cpt.photo_time
from catch_photo_time cpt
where te.id = cpt.event_id
  and te.event_type = 'catch'
  and te.timestamp is distinct from cpt.photo_time;

-- 2) Denormalized table used by maps / social / friend profiles (catches.id = trip_events.id).
with catch_photo_time as (
  select distinct on (p.catch_id)
    p.catch_id    as event_id,
    p.captured_at as photo_time
  from photos p
  where p.catch_id is not null
    and p.captured_at is not null
  order by p.catch_id, p.display_order asc, p.captured_at asc
)
update catches c
set timestamp = cpt.photo_time
from catch_photo_time cpt
where c.id = cpt.event_id
  and c.timestamp is distinct from cpt.photo_time;

-- Review the row counts reported above, then COMMIT or ROLLBACK.
commit;
