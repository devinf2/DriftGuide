-- New-business (shop) admin notification — mirrors the guide_created flow (129).
--   When a business is submitted as 'pending', fan out a 'business_created'
--   activity event to every admin (profiles.is_admin) so they can review/verify
--   it. Push delivery is handled by activity-push; the in-app home bell reads
--   pending businesses directly (RLS lets admins see pending rows).
--
-- Unlike guides (where the actor IS the profile you route to), a business is a
-- distinct entity from its submitter. activity_events had no generic reference
-- column (post_id is FK-locked to posts), so we add a nullable entity_id to
-- carry the business id through to the push tap (-> /business/:id).
--
-- Fires on INSERT of a pending, user-submitted row (created_by not null). The
-- submitter is excluded from recipients. Admin-seeded verified/community rows
-- don't notify.

alter table public.activity_events
  add column if not exists entity_id uuid;

comment on column public.activity_events.entity_id is
  'Generic reference to a non-post subject (e.g. a business for business_created). No FK: may point at different tables per event_type.';

alter table public.activity_events
  drop constraint if exists activity_events_event_type_check;

alter table public.activity_events
  add constraint activity_events_event_type_check
  check (event_type in (
    'post_created', 'post_reaction', 'friend_request', 'friend_accept',
    'guide_booking_request', 'guide_review', 'guide_created', 'business_created'
  ));

create or replace function public.tg_businesses_created_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' and new.created_by is not null then
    insert into public.activity_events (actor_id, recipient_id, event_type, entity_id)
    select new.created_by, p.id, 'business_created', new.id
    from public.profiles p
    where p.is_admin = true
      and p.id <> new.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_businesses_created_activity on businesses;
create trigger trg_businesses_created_activity
  after insert on businesses
  for each row execute function public.tg_businesses_created_activity();
