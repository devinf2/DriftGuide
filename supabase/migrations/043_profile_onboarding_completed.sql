-- First-time profile setup (app onboarding). NULL = show setup flow; set when user finishes.
alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.profiles.onboarding_completed_at is
  'Set when the user completes in-app profile onboarding (name, home state, appearance).';

-- Existing accounts skip onboarding.
update public.profiles
set onboarding_completed_at = now()
where onboarding_completed_at is null;
