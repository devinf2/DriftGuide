-- fly_colors / fly_sizes: shared reference tables. The app inserts rows when a user picks
-- a color/size string that is not yet in the table (see flyService.ensureFlyColorId).
-- Without INSERT policies, saves fail with "violates row-level security policy".

alter table fly_colors enable row level security;
alter table fly_sizes enable row level security;

drop policy if exists "Authenticated can read fly_colors" on fly_colors;
create policy "Authenticated can read fly_colors" on fly_colors
  for select using (auth.role() = 'authenticated');

drop policy if exists "Authenticated can insert fly_colors" on fly_colors;
create policy "Authenticated can insert fly_colors" on fly_colors
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated can read fly_sizes" on fly_sizes;
create policy "Authenticated can read fly_sizes" on fly_sizes
  for select using (auth.role() = 'authenticated');

drop policy if exists "Authenticated can insert fly_sizes" on fly_sizes;
create policy "Authenticated can insert fly_sizes" on fly_sizes
  for insert with check (auth.role() = 'authenticated');
