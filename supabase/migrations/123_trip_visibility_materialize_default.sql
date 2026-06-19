-- trips.trip_photo_visibility should never be null: it is the whole-trip visibility and must
-- be materialized from the owner's profile default at creation, then only change if the user
-- edits it. (Previously null meant "inherit profile default" and was resolved lazily via
-- effective_trip_photo_visibility, which made stored rows null and surprised callers.)
--
-- 1) BEFORE INSERT trigger: fill null from profiles.default_trip_photo_visibility.
-- 2) Backfill existing null rows to the owner's current default.
-- 3) Lock it in: column default + NOT NULL so it can never be null again.

create or replace function public.set_trip_photo_visibility_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.trip_photo_visibility is null then
    -- On UPDATE (e.g. the app upserts trips sending `trip_photo_visibility ?? null`),
    -- never let a null wipe a value the user already has — keep the existing one.
    if tg_op = 'UPDATE' and old.trip_photo_visibility is not null then
      new.trip_photo_visibility := old.trip_photo_visibility;
    else
      select coalesce(pr.default_trip_photo_visibility, 'private'::public.trip_photo_visibility)
        into new.trip_photo_visibility
      from public.profiles pr
      where pr.id = new.user_id;
    end if;

    -- Owner profile missing (shouldn't happen) → safe default.
    if new.trip_photo_visibility is null then
      new.trip_photo_visibility := 'private'::public.trip_photo_visibility;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_trip_photo_visibility_default on public.trips;
create trigger trg_set_trip_photo_visibility_default
  before insert or update on public.trips
  for each row
  execute function public.set_trip_photo_visibility_default();

-- Backfill: snapshot each existing null trip to its owner's current default.
update public.trips t
set trip_photo_visibility = coalesce(
  pr.default_trip_photo_visibility,
  'private'::public.trip_photo_visibility
)
from public.profiles pr
where pr.id = t.user_id
  and t.trip_photo_visibility is null;

-- Any trip whose owner has no profile row → private.
update public.trips
set trip_photo_visibility = 'private'::public.trip_photo_visibility
where trip_photo_visibility is null;

alter table public.trips
  alter column trip_photo_visibility set default 'private'::public.trip_photo_visibility,
  alter column trip_photo_visibility set not null;
