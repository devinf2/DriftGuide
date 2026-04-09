import type { SessionInvite } from '@/src/types';

/** Open the link-trip flow while the invite is still pending; membership is finalized after a trip is attached. */
export function buildLinkTripAfterAcceptPath(inv: SessionInvite): string {
  const q = new URLSearchParams();
  q.set('sessionId', inv.shared_session_id);
  q.set('inviteId', inv.id);
  return `/session/link-trip?${q.toString()}`;
}
