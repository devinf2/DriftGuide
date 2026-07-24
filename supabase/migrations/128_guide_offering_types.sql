-- Guide offerings: a guide_service is now typed as either a bookable trip or a
-- downloadable guide book (PDF). For now BOTH are contact/Venmo-paid off-app —
-- the app just lists them and records an inquiry that notifies the guide.
--
-- Future (deferred): real booking scheduling for 'booking', and paid PDF delivery
-- for 'download' (Apple IAP / RevenueCat, private storage). Columns below are
-- scaffolding for that so no further schema change is needed to light it up.

create type guide_offering_type as enum ('booking', 'download');

alter table guide_services
  add column if not exists offering_type guide_offering_type not null default 'booking',
  -- 'booking': optional cap on spots/quantity per trip. NULL = no stated limit.
  add column if not exists quantity_available integer,
  -- 'download': where the PDF will live (private bucket) once paid delivery ships. NULL for now.
  add column if not exists download_url text;

create index if not exists idx_guide_services_offering_type on guide_services(offering_type);
