-- Link album photos to catches (same id as trip_events row for catch events).
alter table photos
  add column if not exists catch_id uuid references catches(id) on delete cascade;

alter table photos
  add column if not exists display_order smallint not null default 0;

comment on column photos.catch_id is 'When set, this image belongs to a specific catch (catches.id = trip_events.id).';
comment on column photos.display_order is 'Sort order within the same catch (lower first).';

create index if not exists idx_photos_catch_id on photos(catch_id) where catch_id is not null;

-- Backfill catch_id for existing rows that match the denormalized hero URL on catches.
update photos p
set catch_id = c.id
from catches c
where p.catch_id is null
  and c.photo_url is not null
  and p.url = c.photo_url
  and p.user_id = c.user_id
  and p.trip_id = c.trip_id;

-- Orphan catches: URL on catches / legacy path with no photos row — create one album row per catch.
insert into photos (
  user_id,
  trip_id,
  url,
  caption,
  species,
  fly_pattern,
  fly_size,
  fly_color,
  catch_id,
  display_order,
  captured_at
)
select
  c.user_id,
  c.trip_id,
  c.photo_url,
  null,
  c.species,
  c.fly_pattern,
  case when c.fly_size is null then null else c.fly_size::text end,
  c.fly_color,
  c.id,
  0,
  c.timestamp
from catches c
where c.photo_url is not null
  and trim(c.photo_url) <> ''
  and not exists (select 1 from photos p where p.catch_id = c.id)
  and not exists (
    select 1
    from photos p2
    where p2.user_id = c.user_id
      and p2.trip_id = c.trip_id
      and p2.url = c.photo_url
  );

-- Enforce trip_id matches the catch's trip when catch_id is set (CHECK cannot use subqueries in PG).
create or replace function photos_trip_matches_catch_fn()
returns trigger as $$
begin
  if new.catch_id is not null then
    if new.trip_id is null or new.trip_id <> (select trip_id from catches where id = new.catch_id) then
      raise exception 'photos.trip_id must match catches.trip_id when catch_id is set';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists photos_trip_matches_catch_trigger on photos;
create trigger photos_trip_matches_catch_trigger
  before insert or update of catch_id, trip_id on photos
  for each row
  execute function photos_trip_matches_catch_fn();
