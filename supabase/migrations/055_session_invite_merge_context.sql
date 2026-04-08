-- Context for post-trip invites: invitee picks which of their trips to link within a date window.
alter table public.session_invites
  add column if not exists inviter_trip_id uuid references public.trips (id) on delete set null;

alter table public.session_invites
  add column if not exists merge_window_anchor_at timestamptz null;

comment on column public.session_invites.inviter_trip_id is
  'Trip the inviter had open when sending the invite (optional; for audit).';

comment on column public.session_invites.merge_window_anchor_at is
  'Usually the inviter trip start_time; invitee UI shows their completed trips within ±5 days of this instant.';
