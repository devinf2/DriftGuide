-- Standalone map catches (MVP): client-generated UUID primary key for idempotent offline sync.
-- Separate from trip-linked `catches` (018) until timeline is unified.
create table user_catches (
  id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  timestamp timestamptz not null,
  created_at timestamptz not null default now()
);

alter table user_catches enable row level security;

create policy "Users can select own user_catches"
  on user_catches for select
  using (auth.uid() = user_id);

create policy "Users can insert own user_catches"
  on user_catches for insert
  with check (auth.uid() = user_id);

create policy "Users can update own user_catches"
  on user_catches for update
  using (auth.uid() = user_id);

create policy "Users can delete own user_catches"
  on user_catches for delete
  using (auth.uid() = user_id);

create index idx_user_catches_user_id on user_catches (user_id);
create index idx_user_catches_timestamp on user_catches (timestamp desc);
create index idx_user_catches_user_lat on user_catches (user_id, latitude);
create index idx_user_catches_user_lng on user_catches (user_id, longitude);
