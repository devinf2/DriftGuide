-- Fly catalog + user fly box: global fly patterns, reference colors/sizes, user-owned variants.

-- 1) Reference tables: fly_colors, fly_sizes
create table if not exists fly_colors (
  id uuid default uuid_generate_v4() primary key,
  name text not null unique
);

create table if not exists fly_sizes (
  id uuid default uuid_generate_v4() primary key,
  value integer not null unique
);

-- Seed fly_colors (match FLY_COLORS in app)
insert into fly_colors (name) values
  ('Black'), ('Natural'), ('Olive'), ('Tan'), ('Gray'),
  ('Red'), ('Copper'), ('Yellow'), ('Brown'), ('White'),
  ('Dark'), ('Chartreuse'), ('Orange'), ('Purple')
on conflict (name) do nothing;

-- Seed fly_sizes (match FLY_SIZES in app: 8,10,12,14,16,18,20,22,24)
insert into fly_sizes (value) values (8), (10), (12), (14), (16), (18), (20), (22), (24)
on conflict (value) do nothing;

-- 2) Global fly catalog (no user_id, no size, no color)
create table if not exists fly_catalog (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  type fly_type default 'fly' not null,
  photo_url text,
  presentation text,
  created_at timestamptz default now()
);

create index idx_fly_catalog_name on fly_catalog(name);
alter table fly_catalog add constraint fly_catalog_name_type_key unique (name, type);
alter table fly_catalog enable row level security;
-- All authenticated users can read catalog
create policy "Authenticated can read fly_catalog" on fly_catalog for select using (auth.role() = 'authenticated');
-- Allow authenticated insert for "create new pattern" from app
create policy "Authenticated can insert fly_catalog" on fly_catalog for insert with check (auth.role() = 'authenticated');
create policy "Authenticated can update fly_catalog" on fly_catalog for update using (auth.role() = 'authenticated');
create policy "Authenticated can delete fly_catalog" on fly_catalog for delete using (auth.role() = 'authenticated');

-- Seed common patterns (match COMMON_FLIES in app) so catalog has initial options
insert into fly_catalog (name, type, presentation) values
  ('Zebra Midge', 'fly', 'nymph'),
  ('Pheasant Tail Nymph', 'fly', 'nymph'),
  ('Blue Wing Olive', 'fly', 'dry'),
  ('Elk Hair Caddis', 'fly', 'dry'),
  ('Woolly Bugger', 'fly', 'streamer'),
  ('Adams', 'fly', 'dry'),
  ('San Juan Worm', 'fly', 'nymph'),
  ('Hares Ear Nymph', 'fly', 'nymph'),
  ('RS2', 'fly', 'emerger'),
  ('Copper John', 'fly', 'nymph'),
  ('Griffiths Gnat', 'fly', 'dry'),
  ('Parachute Adams', 'fly', 'dry'),
  ('Stimulator', 'fly', 'dry'),
  ('Prince Nymph', 'fly', 'nymph'),
  ('Midges (generic)', 'fly', 'emerger')
on conflict (name, type) do nothing;

-- 3) User fly box: which catalog flies the user owns, with color/size variant
create table if not exists user_fly_box (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  fly_id uuid references fly_catalog(id) on delete cascade not null,
  fly_color_id uuid references fly_colors(id) on delete set null,
  fly_size_id uuid references fly_sizes(id) on delete set null,
  created_at timestamptz default now(),
  unique (user_id, fly_id, fly_color_id, fly_size_id)
);

create index idx_user_fly_box_user_id on user_fly_box(user_id);
create index idx_user_fly_box_fly_id on user_fly_box(fly_id);
alter table user_fly_box enable row level security;
create policy "Users can view own user_fly_box" on user_fly_box for select using (auth.uid() = user_id);
create policy "Users can insert own user_fly_box" on user_fly_box for insert with check (auth.uid() = user_id);
create policy "Users can update own user_fly_box" on user_fly_box for update using (auth.uid() = user_id);
create policy "Users can delete own user_fly_box" on user_fly_box for delete using (auth.uid() = user_id);

-- 4) Data migration from flies -> fly_catalog + user_fly_box (only if flies exists)
do $$
declare
  r record;
  fid uuid;
  cid uuid;
  sid uuid;
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'flies') then
    return;
  end if;

  -- Ensure fly_catalog has one row per distinct (name, type, photo_url, presentation) from flies
  for r in (
    select distinct name, type, photo_url, presentation
    from flies
  )
  loop
    insert into fly_catalog (name, type, photo_url, presentation)
    values (r.name, r.type, r.photo_url, r.presentation)
    on conflict (name, type) do update set photo_url = coalesce(excluded.photo_url, fly_catalog.photo_url), presentation = coalesce(excluded.presentation, fly_catalog.presentation);
  end loop;

  -- For each flies row: resolve catalog id, color id, size id; insert user_fly_box
  for r in select id, user_id, name, type, photo_url, presentation, size, color from flies
  loop
    select id into fid from fly_catalog where name = r.name and type = r.type limit 1;
    if fid is null then
      insert into fly_catalog (name, type, photo_url, presentation)
      values (r.name, r.type, r.photo_url, r.presentation)
      returning id into fid;
    end if;

    cid := null;
    if r.color is not null and r.color <> '' then
      insert into fly_colors (name) values (r.color) on conflict (name) do nothing;
      select id into cid from fly_colors where name = r.color limit 1;
    end if;

    sid := null;
    if r.size is not null then
      insert into fly_sizes (value) values (r.size) on conflict (value) do nothing;
      select id into sid from fly_sizes where value = r.size limit 1;
    end if;

    insert into user_fly_box (user_id, fly_id, fly_color_id, fly_size_id)
    values (r.user_id, fid, cid, sid)
    on conflict (user_id, fly_id, fly_color_id, fly_size_id) do nothing;
  end loop;
end $$;

-- 5) Drop old flies table (RLS and policies go with it)
drop table if exists flies;
