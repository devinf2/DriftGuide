-- Per-catch attribution: who actually caught the fish.
-- caught_by_user_id = null means "me" (the trip owner). The row always stays under
-- the trip owner's user_id (RLS only lets a user write their own catches); the friend's
-- identity is surfaced at the display/attribution layer. caught_for_trip_id is a cached
-- pointer to the attributed friend's trip in a shared session, used only for grouping —
-- it never moves ownership.

alter table public.catches
  add column if not exists caught_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists caught_for_trip_id uuid references public.trips(id) on delete set null;

create index if not exists idx_catches_caught_by_user_id
  on public.catches(caught_by_user_id) where caught_by_user_id is not null;
