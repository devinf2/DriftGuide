import { supabase } from '@/src/services/supabase';
import { fetchProfile } from '@/src/services/friendsService';
import { fetchTripEvents } from '@/src/services/sync';
import type {
  SessionInvite,
  SessionMember,
  SharedSession,
  Trip,
  TripEventWithSource,
} from '@/src/types';
import { sortEventsByTime } from '@/src/utils/journalTimeline';

export async function createSharedSession(title: string | null, creatorId: string): Promise<string | null> {
  const { data: session, error: sErr } = await supabase
    .from('shared_sessions')
    .insert({ created_by: creatorId, title: title?.trim() || null })
    .select('id')
    .single();

  if (sErr || !session?.id) {
    console.warn('[createSharedSession]', sErr);
    return null;
  }

  const sid = session.id as string;
  const { error: mErr } = await supabase.from('session_members').insert({
    shared_session_id: sid,
    user_id: creatorId,
    role: 'owner',
  });

  if (mErr) {
    console.warn('[createSharedSession] member', mErr);
    await supabase.from('shared_sessions').delete().eq('id', sid);
    return null;
  }

  return sid;
}

export async function fetchSharedSession(sessionId: string): Promise<SharedSession | null> {
  const { data, error } = await supabase.from('shared_sessions').select('*').eq('id', sessionId).maybeSingle();
  if (error) {
    console.warn('[fetchSharedSession]', error);
    return null;
  }
  return data as SharedSession | null;
}

export async function listSharedSessionIdsForUser(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('session_members')
    .select('shared_session_id')
    .eq('user_id', userId);
  if (error) {
    console.warn('[listSharedSessionIdsForUser]', error);
    return [];
  }
  return [...new Set((data ?? []).map((r) => r.shared_session_id as string))];
}

export async function listSessionMembers(sessionId: string): Promise<SessionMember[]> {
  const { data, error } = await supabase.from('session_members').select('*').eq('shared_session_id', sessionId);
  if (error) {
    console.warn('[listSessionMembers]', error);
    return [];
  }
  return (data as SessionMember[]) ?? [];
}

export async function listTripsInSession(sessionId: string): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('*, location:locations(*)')
    .eq('shared_session_id', sessionId)
    .is('deleted_at', null);

  if (error) {
    console.warn('[listTripsInSession]', error);
    return [];
  }
  return (data as Trip[]) ?? [];
}

export async function inviteToSession(sessionId: string, inviterId: string, inviteeId: string): Promise<boolean> {
  if (inviterId === inviteeId) return false;
  const { error } = await supabase.from('session_invites').insert({
    shared_session_id: sessionId,
    inviter_id: inviterId,
    invitee_id: inviteeId,
    status: 'pending',
  });
  if (error) {
    console.warn('[inviteToSession]', error);
    return false;
  }
  return true;
}

export async function listPendingSessionInvitesForUser(userId: string): Promise<SessionInvite[]> {
  const { data, error } = await supabase
    .from('session_invites')
    .select('*')
    .eq('invitee_id', userId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());

  if (error) {
    console.warn('[listPendingSessionInvitesForUser]', error);
    return [];
  }
  return (data as SessionInvite[]) ?? [];
}

export async function listSessionInvitesSentFromSession(sessionId: string): Promise<SessionInvite[]> {
  const { data, error } = await supabase.from('session_invites').select('*').eq('shared_session_id', sessionId);
  if (error) {
    console.warn('[listSessionInvitesSentFromSession]', error);
    return [];
  }
  return (data as SessionInvite[]) ?? [];
}

export async function acceptSessionInvite(invite: SessionInvite, userId: string): Promise<boolean> {
  if (invite.invitee_id !== userId || invite.status !== 'pending') return false;

  const { error: uErr } = await supabase
    .from('session_invites')
    .update({ status: 'accepted' })
    .eq('id', invite.id);

  if (uErr) {
    console.warn('[acceptSessionInvite] update', uErr);
    return false;
  }

  const { error: mErr } = await supabase.from('session_members').insert({
    shared_session_id: invite.shared_session_id,
    user_id: userId,
    role: 'member',
  });

  if (mErr) {
    console.warn('[acceptSessionInvite] member', mErr);
    return false;
  }
  return true;
}

export async function declineSessionInvite(inviteId: string): Promise<boolean> {
  const { error } = await supabase.from('session_invites').delete().eq('id', inviteId);
  if (error) {
    console.warn('[declineSessionInvite]', error);
    return false;
  }
  return true;
}

export async function attachTripToSession(tripId: string, sessionId: string): Promise<boolean> {
  const { error } = await supabase.from('trips').update({ shared_session_id: sessionId }).eq('id', tripId);
  if (error) {
    console.warn('[attachTripToSession]', error);
    return false;
  }
  return true;
}

export async function detachTripFromSession(tripId: string): Promise<boolean> {
  const { error } = await supabase.from('trips').update({ shared_session_id: null }).eq('id', tripId);
  if (error) {
    console.warn('[detachTripFromSession]', error);
    return false;
  }
  return true;
}

export async function leaveSession(sessionId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('session_members')
    .delete()
    .eq('shared_session_id', sessionId)
    .eq('user_id', userId);

  if (error) {
    console.warn('[leaveSession]', error);
    return false;
  }
  return true;
}

/** Merged Group timeline: all events from trips in the session, sorted, with attribution. */
export async function fetchMergedSessionEvents(sessionId: string): Promise<TripEventWithSource[]> {
  const trips = await listTripsInSession(sessionId);
  if (trips.length === 0) return [];

  const nameByUser = new Map<string, string>();
  for (const t of trips) {
    if (!nameByUser.has(t.user_id)) {
      const p = await fetchProfile(t.user_id);
      nameByUser.set(t.user_id, p?.display_name?.trim() || 'Angler');
    }
  }

  const merged: TripEventWithSource[] = [];
  for (const trip of trips) {
    const events = await fetchTripEvents(trip.id);
    const name = nameByUser.get(trip.user_id) ?? 'Angler';
    for (const e of events) {
      merged.push({
        ...e,
        source_user_id: trip.user_id,
        source_display_name: name,
      });
    }
  }

  return sortEventsByTime(merged as import('@/src/types').TripEvent[]) as TripEventWithSource[];
}

export async function findTripForUserInSession(sessionId: string, userId: string): Promise<Trip | null> {
  const { data, error } = await supabase
    .from('trips')
    .select('*, location:locations(*)')
    .eq('shared_session_id', sessionId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    console.warn('[findTripForUserInSession]', error);
    return null;
  }
  return data as Trip | null;
}
