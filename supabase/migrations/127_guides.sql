-- Guide / Pro marketplace.
--   guide_profiles : 1:1 extension of profiles for anglers who offer paid services.
--   guide_services : sellable offerings (contact-based booking in v1; no in-app payment).
--   guide_bookings : inquiry log (requested/accepted/declined/completed/cancelled).
--   guide_reviews  : ratings, primarily seeded from a completed trip the guide ran.
--   trips.guide_id : attributes a trip to a guide -> public trip history + review source.
--
-- Verification (the checkmark) = guide_profiles.verified_at set by an admin.
-- Booking/service payment happens OFF-app; only guide books (Phase 4) use Apple IAP.
-- Reuses is_admin() (migration 125) and the activity_events -> activity-push pipeline (117/119).

create type guide_status as enum ('pending', 'approved', 'suspended');
create type guide_booking_status as enum ('requested', 'accepted', 'declined', 'completed', 'cancelled');

-- ---------------------------------------------------------------------------
-- guide_profiles
-- ---------------------------------------------------------------------------
create table guide_profiles (
  profile_id uuid primary key references profiles(id) on delete cascade,
  bio text,
  home_water text,
  years_experience integer,
  rates jsonb not null default '{}'::jsonb,
  contact_email text,
  contact_phone text,
  booking_url text,
  status guide_status not null default 'pending',
  verified_at timestamptz,
  verified_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_guide_profiles_status on guide_profiles(status);

-- New profiles start pending & unverified unless created by an admin.
create or replace function guide_profiles_force_pending()
returns trigger as $$
begin
  if not is_admin(new.profile_id) then
    new.status := 'pending';
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger guide_profiles_force_pending_trg
  before insert on guide_profiles
  for each row execute function guide_profiles_force_pending();

-- Non-admins cannot change their own verification/status (no self-verify).
create or replace function guide_profiles_guard_verification()
returns trigger as $$
begin
  if not is_admin() then
    new.status := old.status;
    new.verified_at := old.verified_at;
    new.verified_by := old.verified_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger guide_profiles_guard_verification_trg
  before update on guide_profiles
  for each row execute function guide_profiles_guard_verification();

alter table guide_profiles enable row level security;

create policy "guide_profiles_select_visible" on guide_profiles for select
  using (status = 'approved' or profile_id = auth.uid() or is_admin());

create policy "guide_profiles_insert_own" on guide_profiles for insert
  with check (auth.role() = 'authenticated' and profile_id = auth.uid());

create policy "guide_profiles_update_own_or_admin" on guide_profiles for update
  using (profile_id = auth.uid() or is_admin())
  with check (profile_id = auth.uid() or is_admin());

create policy "guide_profiles_delete_own_or_admin" on guide_profiles for delete
  using (profile_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------------
-- guide_services
-- ---------------------------------------------------------------------------
create table guide_services (
  id uuid primary key default uuid_generate_v4(),
  guide_id uuid not null references guide_profiles(profile_id) on delete cascade,
  title text not null,
  location_id uuid references locations(id) on delete set null,
  price_cents integer,
  duration_label text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_guide_services_guide_id on guide_services(guide_id);

alter table guide_services enable row level security;

create policy "guide_services_select_visible" on guide_services for select
  using (
    guide_id = auth.uid()
    or is_admin()
    or exists (select 1 from guide_profiles g where g.profile_id = guide_id and g.status = 'approved')
  );

create policy "guide_services_write_own_or_admin" on guide_services for all
  using (guide_id = auth.uid() or is_admin())
  with check (guide_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------------
-- guide_bookings (contact-based inquiries; payment/scheduling happen off-app)
-- ---------------------------------------------------------------------------
create table guide_bookings (
  id uuid primary key default uuid_generate_v4(),
  guide_id uuid not null references guide_profiles(profile_id) on delete cascade,
  requester_id uuid not null references profiles(id) on delete cascade,
  service_id uuid references guide_services(id) on delete set null,
  requested_date date,
  party_size integer,
  message text,
  status guide_booking_status not null default 'requested',
  created_at timestamptz not null default now()
);

create index idx_guide_bookings_guide_id on guide_bookings(guide_id);
create index idx_guide_bookings_requester_id on guide_bookings(requester_id);

alter table guide_bookings enable row level security;

create policy "guide_bookings_select_party" on guide_bookings for select
  using (requester_id = auth.uid() or guide_id = auth.uid() or is_admin());

create policy "guide_bookings_insert_own" on guide_bookings for insert
  with check (auth.role() = 'authenticated' and requester_id = auth.uid());

-- Guide accepts/declines/completes; requester can cancel.
create policy "guide_bookings_update_party" on guide_bookings for update
  using (guide_id = auth.uid() or requester_id = auth.uid() or is_admin())
  with check (guide_id = auth.uid() or requester_id = auth.uid() or is_admin());

create policy "guide_bookings_delete_party" on guide_bookings for delete
  using (requester_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------------
-- guide_reviews (public; primary source = a completed trip the guide ran)
-- ---------------------------------------------------------------------------
create table guide_reviews (
  id uuid primary key default uuid_generate_v4(),
  guide_id uuid not null references guide_profiles(profile_id) on delete cascade,
  reviewer_id uuid not null references profiles(id) on delete cascade,
  trip_id uuid references trips(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  body text,
  created_at timestamptz not null default now()
);

create index idx_guide_reviews_guide_id on guide_reviews(guide_id);
-- One review per reviewer per trip (trip-seeded reviews stay unique).
create unique index uq_guide_reviews_reviewer_trip on guide_reviews(reviewer_id, trip_id) where trip_id is not null;

alter table guide_reviews enable row level security;

create policy "guide_reviews_select_all" on guide_reviews for select using (true);

create policy "guide_reviews_insert_own" on guide_reviews for insert
  with check (auth.role() = 'authenticated' and reviewer_id = auth.uid());

create policy "guide_reviews_update_own_or_admin" on guide_reviews for update
  using (reviewer_id = auth.uid() or is_admin())
  with check (reviewer_id = auth.uid() or is_admin());

create policy "guide_reviews_delete_own_or_admin" on guide_reviews for delete
  using (reviewer_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------------
-- trips.guide_id — attribute a trip to a guide (public history + review source)
-- ---------------------------------------------------------------------------
alter table trips add column if not exists guide_id uuid references guide_profiles(profile_id) on delete set null;
create index if not exists idx_trips_guide_id on trips(guide_id);

-- ---------------------------------------------------------------------------
-- Public stats for a guide profile (rating avg/count + completed trips).
-- SECURITY DEFINER so completed-trip counts don't depend on per-trip RLS visibility.
-- ---------------------------------------------------------------------------
create or replace function guide_public_stats(p_guide_id uuid)
returns table(avg_rating numeric, review_count integer, trips_completed integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(round(avg(r.rating)::numeric, 1), 0) as avg_rating,
    count(r.*)::int as review_count,
    (
      select count(*)::int from trips t
      where t.guide_id = p_guide_id and t.status = 'completed' and t.deleted_at is null
    ) as trips_completed
  from guide_reviews r
  where r.guide_id = p_guide_id;
$$;

-- ---------------------------------------------------------------------------
-- Push: booking requests + new reviews notify the guide (reuse activity_events).
-- ---------------------------------------------------------------------------
alter table public.activity_events
  drop constraint if exists activity_events_event_type_check;

alter table public.activity_events
  add constraint activity_events_event_type_check
  check (event_type in (
    'post_created', 'post_reaction', 'friend_request', 'friend_accept',
    'guide_booking_request', 'guide_review'
  ));

create or replace function public.tg_guide_bookings_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.requester_id is distinct from new.guide_id then
    insert into public.activity_events (actor_id, recipient_id, event_type)
    values (new.requester_id, new.guide_id, 'guide_booking_request');
  end if;
  return new;
end;
$$;

create trigger trg_guide_bookings_activity
  after insert on guide_bookings
  for each row execute function public.tg_guide_bookings_activity();

create or replace function public.tg_guide_reviews_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reviewer_id is distinct from new.guide_id then
    insert into public.activity_events (actor_id, recipient_id, event_type)
    values (new.reviewer_id, new.guide_id, 'guide_review');
  end if;
  return new;
end;
$$;

create trigger trg_guide_reviews_activity
  after insert on guide_reviews
  for each row execute function public.tg_guide_reviews_activity();
