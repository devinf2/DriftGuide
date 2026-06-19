-- Friend-request push notifications.
--
-- Until now, sending or accepting a friend request produced no notification — the
-- recipient had to open Profile → Friends → Requests to discover a pending request.
-- This reuses the existing activity_events → activity-push pipeline (migrations 117/119):
-- a row written to public.activity_events with processed_at NULL is picked up by the
-- activity-push edge function, fanned out to the recipient's device_tokens, and stamped.
--
-- 1) Widen the event_type check constraint to allow 'friend_request' and 'friend_accept'.
-- 2) AFTER INSERT on friendships (status 'pending')  -> notify the addressee (the non-requester).
-- 3) AFTER UPDATE pending -> accepted               -> notify the original requester.
--
-- Both events are targeted (recipient_id set), like 'post_reaction' — never fanned out.
-- Triggers are SECURITY DEFINER so they may insert into activity_events under RLS,
-- mirroring tg_posts_activity / tg_post_reactions_activity in migration 117.

-- 1) Allow the two new event types.
alter table public.activity_events
  drop constraint if exists activity_events_event_type_check;

alter table public.activity_events
  add constraint activity_events_event_type_check
  check (event_type in ('post_created', 'post_reaction', 'friend_request', 'friend_accept'));

-- 2) New pending request -> notify the addressee.
create or replace function public.tg_friendships_request_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
begin
  if new.status = 'pending' and new.requested_by is not null then
    -- The addressee is whichever side of the ordered pair did NOT send the request.
    v_recipient := case
      when new.requested_by = new.profile_min then new.profile_max
      else new.profile_min
    end;
    if v_recipient is distinct from new.requested_by then
      insert into public.activity_events (actor_id, recipient_id, event_type)
      values (new.requested_by, v_recipient, 'friend_request');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_friendships_request_activity on public.friendships;
create trigger trg_friendships_request_activity
  after insert on public.friendships
  for each row execute function public.tg_friendships_request_activity();

-- 3) Request accepted -> notify the original requester.
create or replace function public.tg_friendships_accept_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  -- Only the pending -> accepted transition; ignore re-saves and other status changes.
  if new.status = 'accepted'
     and old.status is distinct from 'accepted'
     and old.requested_by is not null then
    -- The accepter is the addressee of the original request (the non-requester).
    v_actor := case
      when old.requested_by = new.profile_min then new.profile_max
      else new.profile_min
    end;
    if v_actor is distinct from old.requested_by then
      insert into public.activity_events (actor_id, recipient_id, event_type)
      values (v_actor, old.requested_by, 'friend_accept');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_friendships_accept_activity on public.friendships;
create trigger trg_friendships_accept_activity
  after update on public.friendships
  for each row execute function public.tg_friendships_accept_activity();
