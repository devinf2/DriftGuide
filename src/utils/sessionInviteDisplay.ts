import { format } from 'date-fns';
import type { SessionInvite, Trip } from '@/src/types';

/** One-line summary for a pending session invite (home / friends). */
export function formatPendingSessionInviteSummary(
  inviterName: string,
  invite: SessionInvite,
  templateTrip: Trip | null,
): string {
  const place = templateTrip?.location?.name?.trim();
  const timeSource = templateTrip?.start_time ?? invite.merge_window_anchor_at ?? null;
  let datePart = '';
  if (timeSource) {
    const d = new Date(timeSource);
    if (!Number.isNaN(d.getTime())) {
      datePart = format(d, 'MMM d, yyyy');
    }
  }
  if (place && datePart) {
    return `${inviterName} invited you to a trip at ${place} on ${datePart}`;
  }
  if (place) {
    return `${inviterName} invited you to a trip at ${place}`;
  }
  if (datePart) {
    return `${inviterName} invited you to a trip on ${datePart}`;
  }
  return `${inviterName} invited you to a trip`;
}
