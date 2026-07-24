-- Partner program + promotions.
--   partners        : organizations (e.g. Uinta Life Fishing Collective) with a community link.
--   business_deals  : a discount/offer on a business, linking members to the partner community.
--   promotions      : generic admin-curated featured content (home rail; also used for guides later).
-- All are admin-managed; everyone reads active rows. Builds on is_admin() from migration 125.

-- ---------------------------------------------------------------------------
-- partners
-- ---------------------------------------------------------------------------
create table partners (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  community_url text,            -- e.g. the Skool community URL
  logo_url text,
  description text,
  created_at timestamptz not null default now()
);

alter table partners enable row level security;

create policy "partners_select_all" on partners for select using (true);
create policy "partners_write_admin" on partners for all
  using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- business_deals
-- ---------------------------------------------------------------------------
create table business_deals (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  partner_id uuid references partners(id) on delete set null,
  title text not null,           -- "10% off guided floats"
  detail text,
  cta_url text,                  -- defaults (in app) to the partner's community_url when null
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_business_deals_business_id on business_deals(business_id);
create index idx_business_deals_partner_id on business_deals(partner_id);

alter table business_deals enable row level security;

-- Everyone sees active, in-window deals; admins see all (to manage).
create policy "business_deals_select_active" on business_deals for select
  using (
    is_admin()
    or (
      active
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at >= now())
    )
  );

create policy "business_deals_write_admin" on business_deals for all
  using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- promotions (featured content placements)
-- ---------------------------------------------------------------------------
create type promotion_subject as enum ('business', 'deal', 'guide');
create type promotion_placement as enum ('home_featured');

create table promotions (
  id uuid primary key default uuid_generate_v4(),
  subject_type promotion_subject not null,
  subject_id uuid not null,      -- id of a business / deal / guide, per subject_type
  placement promotion_placement not null default 'home_featured',
  priority integer not null default 0,   -- higher shows first
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_promotions_placement on promotions(placement);

alter table promotions enable row level security;

create policy "promotions_select_active" on promotions for select
  using (
    is_admin()
    or (
      active
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at >= now())
    )
  );

create policy "promotions_write_admin" on promotions for all
  using (is_admin()) with check (is_admin());
