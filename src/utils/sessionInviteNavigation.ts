import type { SessionInvite } from '@/src/types';

/** Navigate here after accepting a fishing-group invite so the invitee can attach their live trip. */
export function buildLinkTripAfterAcceptPath(inv: SessionInvite): string {
  const q = new URLSearchParams();
  q.set('sessionId', inv.shared_session_id);
  q.set('inviteId', inv.id);
  return `/session/link-trip?${q.toString()}`;
}
