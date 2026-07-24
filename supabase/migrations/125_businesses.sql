-- Business directory: outfitters, lodges, fly shops shown on the map with a
-- Google-Business-style detail page. Community-submitted + moderated, mirroring
-- the locations `community`/`pending`/`verified` provenance model and the
-- access_points force-pending trigger.
--
-- Businesses are a STANDALONE table (not a location_type) so the fishing-spot
-- catalog + intel screens stay clean. They reuse the map-marker layer, the
-- `photos` storage bucket, and the soft-delete convention.

-- ---------------------------------------------------------------------------
-- Admin helper (shared by every phase: moderation + verification)
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists is_admin boolean not null default false;
comment on column profiles.is_admin is 'Grants moderation/verification powers (approve businesses, verify guides, curate promotions).';

-- SECURITY DEFINER so RLS policies can check admin status without recursive
-- profile-table RLS. Defaults to the current user.
create or replace function is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from profiles p where p.id = uid), false);
$$;

-- ---------------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------------
create type business_category as enum ('outfitter', 'lodge', 'fly_shop', 'guide_service', 'other');

create table businesses (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  category business_category not null default 'other',
  latitude double precision not null,
  longitude double precision not null,
  address text,
  state text,
  description text,
  website_url text,
  phone text,
  email text,
  hours jsonb not null default '{}'::jsonb,       -- { mon: {open,close}, ... }
  logo_url text,
  cover_url text,
  status text not null default 'pending' check (status in ('verified', 'community', 'pending')),
  created_by uuid references profiles(id),
  usage_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references profiles(id)
);

create index idx_businesses_status on businesses(status);
create index idx_businesses_created_by on businesses(created_by);
create index idx_businesses_category on businesses(category);
create index idx_businesses_state on businesses(state);
-- Viewport queries filter on lat/lng bounds.
create index idx_businesses_lat_lng on businesses(latitude, longitude);

-- User-submitted rows always start pending; admins may seed verified directly.
create or replace function businesses_force_pending_for_users()
returns trigger as $$
begin
  if new.created_by is not null and not is_admin(new.created_by) then
    new.status := 'pending';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger businesses_force_pending
  before insert on businesses
  for each row
  execute function businesses_force_pending_for_users();

alter table businesses enable row level security;

create policy "businesses_select_visible"
  on businesses for select
  using (
    deleted_at is null
    and (status = 'verified' or created_by = auth.uid() or is_admin())
  );

create policy "businesses_insert_own"
  on businesses for insert
  with check (
    auth.role() = 'authenticated'
    and created_by = auth.uid()
  );

-- Owner may edit their own live row; admins may edit any (moderation/verify).
create policy "businesses_update_own_or_admin"
  on businesses for update
  using ((created_by = auth.uid() and deleted_at is null) or is_admin())
  with check ((created_by = auth.uid() and deleted_at is null) or is_admin());

create policy "businesses_delete_own_or_admin"
  on businesses for delete
  using (created_by = auth.uid() or is_admin());

-- ---------------------------------------------------------------------------
-- business_photos (gallery; files live in the existing `photos` bucket under
-- photos/{uploaderId}/ so existing storage policies already permit uploads)
-- ---------------------------------------------------------------------------
create table business_photos (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  photo_url text not null,
  sort_order integer not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_business_photos_business_id on business_photos(business_id);

alter table business_photos enable row level security;

create policy "business_photos_select_visible"
  on business_photos for select
  using (
    created_by = auth.uid()
    or is_admin()
    or exists (
      select 1 from businesses b
      where b.id = business_id
        and b.deleted_at is null
        and b.status = 'verified'
    )
  );

-- Only the owning business's creator (or an admin) may add/remove gallery photos.
create policy "business_photos_insert_owner"
  on business_photos for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from businesses b
      where b.id = business_id
        and (b.created_by = auth.uid() or is_admin())
    )
  );

create policy "business_photos_delete_owner"
  on business_photos for delete
  using (created_by = auth.uid() or is_admin());
