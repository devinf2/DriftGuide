alter table public.session_invites
  add column if not exists invite_kind text
  check (invite_kind is null or invite_kind in ('upcoming', 'past'));

comment on column public.session_invites.invite_kind is
  'upcoming: inviter on active/planned outing — invitee receives a planned trip to start later. past: inviter shared a completed outing — invitee links an existing completed trip or imports one.';
