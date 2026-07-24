-- New-guide admin notification.
--   When a guide_profile is first created, fan out a 'guide_created' activity
--   event to every admin (profiles.is_admin) so they can review/approve it.
--   Push delivery is handled by activity-push (resolves title/body + routes the
--   tap to /guide/:actorId). The in-app home bell reads pending guides directly
--   from guide_profiles (RLS lets admins see pending rows) — it does not depend
--   on these event rows.
--
-- Fires on INSERT only, so editing a guide profile later never re-notifies
-- (upsertGuideProfile's conflict path is an UPDATE). The actor (the new guide)
-- is excluded from recipients, so an admin creating their own profile isn't
-- pinged about it. Reuses the activity_events -> activity-push pipeline (117/119).

alter table public.activity_events
  drop constraint if exists activity_events_event_type_check;

alter table public.activity_events
  add constraint activity_events_event_type_check
  check (event_type in (
    'post_created', 'post_reaction', 'friend_request', 'friend_accept',
    'guide_booking_request', 'guide_review', 'guide_created'
  ));

create or replace function public.tg_guide_profiles_created_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_events (actor_id, recipient_id, event_type)
  select new.profile_id, p.id, 'guide_created'
  from public.profiles p
  where p.is_admin = true
    and p.id <> new.profile_id;
  return new;
end;
$$;

create trigger trg_guide_profiles_created_activity
  after insert on guide_profiles
  for each row execute function public.tg_guide_profiles_created_activity();
