-- Per-user favorite catalog locations (for ranking tie-breaks and map hearts).

create table public.user_favorite_locations (
  user_id uuid not null references public.profiles (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, location_id)
);

create index idx_user_favorite_locations_user_id on public.user_favorite_locations (user_id);

alter table public.user_favorite_locations enable row level security;

create policy "Users can view own favorite locations"
  on public.user_favorite_locations for select
  using (auth.uid() = user_id);

create policy "Users can insert own favorite locations"
  on public.user_favorite_locations for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own favorite locations"
  on public.user_favorite_locations for delete
  using (auth.uid() = user_id);
