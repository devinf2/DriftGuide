-- Access points: moderated public pins tied to a general area (location).
-- Trips and catches: optional access_point_id for "starting access" context.

create type access_point_status as enum ('pending', 'approved');

create table access_points (
  id uuid primary key default uuid_generate_v4(),
  location_id uuid not null references locations(id) on delete cascade,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  status access_point_status not null default 'pending',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_access_points_location_id on access_points(location_id);
create index idx_access_points_created_by on access_points(created_by);
create index idx_access_points_status on access_points(status);

-- User-submitted rows always stay pending (approve via SQL / dashboard).
create or replace function access_points_force_pending_for_users()
returns trigger as $$
begin
  if new.created_by is not null then
    new.status := 'pending'::access_point_status;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger access_points_force_pending
  before insert on access_points
  for each row
  execute function access_points_force_pending_for_users();

alter table access_points enable row level security;

create policy "access_points_select_visible"
  on access_points for select
  using (
    status = 'approved'::access_point_status
    or created_by = auth.uid()
  );

create policy "access_points_insert_own"
  on access_points for insert
  with check (
    auth.role() = 'authenticated'
    and created_by = auth.uid()
  );

create policy "access_points_update_own_pending"
  on access_points for update
  using (created_by = auth.uid() and status = 'pending'::access_point_status)
  with check (created_by = auth.uid() and status = 'pending'::access_point_status);

create policy "access_points_delete_own_pending"
  on access_points for delete
  using (created_by = auth.uid() and status = 'pending'::access_point_status);

alter table trips add column if not exists access_point_id uuid references access_points(id) on delete set null;
create index if not exists idx_trips_access_point_id on trips(access_point_id);

alter table catches add column if not exists access_point_id uuid references access_points(id) on delete set null;
create index if not exists idx_catches_access_point_id on catches(access_point_id);
