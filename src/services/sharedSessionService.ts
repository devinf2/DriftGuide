import { supabase } from '@/src/services/supabase';
import { fetchProfile } from '@/src/services/friendsService';
import { fetchTripById, fetchTripEvents } from '@/src/services/sync';
import type {
  Location,
  SessionInvite,
  SessionMember,
  SharedSession,
  Trip,
  TripEventWithSource,
} from '@/src/types';
import { sortEventsByTime } from '@/src/utils/journalTimeline';

export type CreateSharedSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; message: string };

export async function createSharedSession(
  title: string | null,
  creatorId: string,
): Promise<CreateSharedSessionResult> {
  const { data: session, error: sErr } = await supabase
    .from('shared_sessions')
    .insert({ created_by: creatorId, title: title?.trim() || null })
    .select('id')
    .single();

  if (sErr || !session?.id) {
    console.warn('[createSharedSession]', sErr);
    return {
      ok: false,
      message: sErr?.message?.trim() || 'Could not create group.',
    };
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
    return {
      ok: false,
      message: mErr.message?.trim() || 'Could not add you to the group.',
    };
  }

  return { ok: true, sessionId: sid };
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
  const { data: rpcData, error: rpcError } = await supabase.rpc('list_trips_in_shared_session', {
    p_session_id: sessionId,
  });
  if (!rpcError && rpcData != null) {
    const rows = (rpcData as Trip[]) ?? [];
    if (rows.length === 0) return [];
    const locationIds = [...new Set(rows.map((t) => t.location_id).filter(Boolean))] as string[];
    if (locationIds.length === 0) return rows;
    const { data: locRows, error: locErr } = await supabase
      .from('locations')
      .select('*')
      .in('id', locationIds);
    if (locErr || !locRows?.length) return rows;
    const locById = new Map((locRows as Location[]).map((l) => [l.id, l]));
    return rows.map((t) => (t.location_id ? { ...t, location: locById.get(t.location_id) } : t));
  }
  if (rpcError) {
    console.warn('[listTripsInSession] rpc failed, falling back to direct select', rpcError);
  }
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

export type InviteToSessionOptions = {
  /** Inviter's trip row (the outing they are grouping). */
  inviterTripId?: string | null;
  /** Copied from that trip's `start_time` so the invitee can pick a trip within ±5 days without reading your row. */
  mergeWindowAnchorAt?: string | null;
  /** upcoming = active/planned inviter outing; past = completed inviter outing. */
  inviteKind?: 'upcoming' | 'past' | null;
};

export async function inviteToSession(
  sessionId: string,
  inviterId: string,
  inviteeId: string,
  options?: InviteToSessionOptions,
): Promise<boolean> {
  if (inviterId === inviteeId) return false;
  const { error } = await supabase.from('session_invites').insert({
    shared_session_id: sessionId,
    inviter_id: inviterId,
    invitee_id: inviteeId,
    status: 'pending',
    inviter_trip_id: options?.inviterTripId ?? null,
    merge_window_anchor_at: options?.mergeWindowAnchorAt ?? null,
    invite_kind: options?.inviteKind ?? null,
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
  const rows = (data as SessionInvite[]) ?? [];
  return rows.filter((inv) => inv.inviter_id !== inv.invitee_id);
}

export async function listSessionInvitesSentFromSession(sessionId: string): Promise<SessionInvite[]> {
  const { data, error } = await supabase
    .from('session_invites')
    .select('*')
    .eq('shared_session_id', sessionId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());
  if (error) {
    console.warn('[listSessionInvitesSentFromSession]', error);
    return [];
  }
  return (data as SessionInvite[]) ?? [];
}

export async function acceptSessionInvite(invite: SessionInvite, userId: string): Promise<boolean> {
  if (invite.invitee_id !== userId || invite.inviter_id === invite.invitee_id) return false;

  const fresh = await fetchSessionInviteById(invite.id);
  if (!fresh || fresh.invitee_id !== userId) return false;

  if (fresh.status === 'accepted') {
    const { data: row } = await supabase
      .from('session_members')
      .select('user_id')
      .eq('shared_session_id', fresh.shared_session_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (row) return true;
    const { error: repairErr } = await supabase.from('session_members').insert({
      shared_session_id: fresh.shared_session_id,
      user_id: userId,
      role: 'member',
    });
    if (!repairErr) return true;
    if ((repairErr as { code?: string }).code === '23505') return true;
    console.warn('[acceptSessionInvite] member repair', repairErr);
    return false;
  }

  if (fresh.status !== 'pending') return false;

  const { error: uErr } = await supabase
    .from('session_invites')
    .update({ status: 'accepted' })
    .eq('id', invite.id)
    .eq('status', 'pending');

  if (uErr) {
    console.warn('[acceptSessionInvite] update', uErr);
    return false;
  }

  const { error: mErr } = await supabase.from('session_members').insert({
    shared_session_id: fresh.shared_session_id,
    user_id: userId,
    role: 'member',
  });

  if (mErr) {
    if ((mErr as { code?: string }).code === '23505') return true;
    console.warn('[acceptSessionInvite] member', mErr);
    return false;
  }
  return true;
}

export async function fetchSessionInviteById(inviteId: string): Promise<SessionInvite | null> {
  const { data, error } = await supabase.from('session_invites').select('*').eq('id', inviteId).maybeSingle();
  if (error) {
    console.warn('[fetchSessionInviteById]', error);
    return null;
  }
  return (data as SessionInvite) ?? null;
}

/**
 * Trip to copy location / fishing context from when the invitee has no outing yet.
 * Uses `inviter_trip_id` when present; otherwise the inviter’s most recent trip in the session.
 */
export async function resolveInviterTemplateTripForJoin(
  sessionId: string,
  invite: SessionInvite,
): Promise<Trip | null> {
  const tid = invite.inviter_trip_id?.trim();
  if (tid) {
    const t = await fetchTripById(tid);
    if (t && !t.deleted_at && t.user_id === invite.inviter_id) return t;
  }
  const trips = await listTripsInSession(sessionId);
  const inviterTrips = trips.filter((x) => x.user_id === invite.inviter_id && !x.deleted_at);
  inviterTrips.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  return inviterTrips[0] ?? null;
}

export async function declineSessionInvite(inviteId: string): Promise<boolean> {
  const { error: delErr } = await supabase.from('session_invites').delete().eq('id', inviteId);
  if (!delErr) return true;

  console.warn('[declineSessionInvite] delete', delErr);
  // Older DBs had no DELETE RLS on session_invites; treat as declined so the row disappears from pending lists.
  const { error: updErr } = await supabase
    .from('session_invites')
    .update({ status: 'declined' })
    .eq('id', inviteId)
    .eq('status', 'pending');
  if (updErr) {
    console.warn('[declineSessionInvite] update', updErr);
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

/** Merged Group timeline: all events from the given session child trips, sorted, with attribution by trip + user. */
export async function fetchMergedSessionEventsForTrips(trips: Trip[]): Promise<TripEventWithSource[]> {
  if (trips.length === 0) return [];

  const nameByUser = new Map<string, string>();
  for (const t of trips) {
    if (!nameByUser.has(t.user_id)) {
      const p = await fetchProfile(t.user_id);
      nameByUser.set(t.user_id, p?.display_name?.trim() || 'Angler');
    }
  }

  const merged: TripEventWithSource[] = [];
  for (const tr of trips) {
    const evs = await fetchTripEvents(tr.id);
    const name = nameByUser.get(tr.user_id) ?? 'Angler';
    for (const e of evs) {
      merged.push({
        ...e,
        source_user_id: tr.user_id,
        source_display_name: name,
        source_trip_id: tr.id,
      });
    }
  }

  return sortEventsByTime(merged as import('@/src/types').TripEvent[]) as TripEventWithSource[];
}

export async function fetchMergedSessionEvents(sessionId: string): Promise<TripEventWithSource[]> {
  const trips = await listTripsInSession(sessionId);
  return fetchMergedSessionEventsForTrips(trips);
}

export async function findTripForUserInSession(sessionId: string, userId: string): Promise<Trip | null> {
  const trips = await listTripsInSession(sessionId);
  const mine = trips.filter((t) => t.user_id === userId);
  if (mine.length === 0) return null;
  mine.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  return mine[0] ?? null;
}
