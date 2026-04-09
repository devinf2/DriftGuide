import type { SessionInvite, Trip } from '@/src/types';
import { parseISO } from 'date-fns';

const MERGE_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

/** Anchor instant for ±5-day merge window (planned trips use planned date at noon). */
export function mergeAnchorIsoFromInviterTrip(trip: Trip): string {
  if (trip.status === 'planned' && trip.planned_date?.trim()) {
    const d = parseISO(`${trip.planned_date.trim()}T12:00:00`);
    return Number.isNaN(d.getTime()) ? trip.start_time : d.toISOString();
  }
  return trip.start_time;
}

/**
 * Chooses link UX for the invitee. `invite_kind` reflects the inviter at send time, but the inviter may
 * end their trip before the invitee opens the link — always treat a completed inviter template as "past".
 */
export function resolveSessionInviteFlow(invite: SessionInvite, template: Trip | null): 'upcoming' | 'past' {
  if (invite.invite_kind === 'past') return 'past';
  if (template && !template.deleted_at && template.status === 'completed') return 'past';
  if (invite.invite_kind === 'upcoming') return 'upcoming';
  return 'upcoming';
}

export function mergeWindowAnchorIso(invite: SessionInvite, template: Trip | null): string | null {
  return invite.merge_window_anchor_at ?? template?.start_time ?? null;
}

export function isCompletedTripInInviteMergeWindow(trip: Trip, anchorIso: string | null): boolean {
  if (trip.status !== 'completed' || trip.deleted_at) return false;
  if (!anchorIso) return true;
  const anchor = new Date(anchorIso).getTime();
  const tripTime = new Date(trip.start_time).getTime();
  if (Number.isNaN(anchor) || Number.isNaN(tripTime)) return false;
  return Math.abs(tripTime - anchor) <= MERGE_WINDOW_MS;
}

/** Planned-trip date for the invitee’s upcoming group outing (mirrors inviter context). */
export function plannedDateForUpcomingInvite(template: Trip): Date {
  if (template.status === 'planned' && template.planned_date?.trim()) {
    const d = parseISO(`${template.planned_date.trim()}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const day = template.start_time.split('T')[0] ?? '';
  const d = parseISO(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** In-progress outing: link to the group for a live shared timeline (paused still counts as same session). */
export function canJoinSessionWithCurrentTrip(trip: Trip | null | undefined): trip is Trip {
  return Boolean(
    trip &&
      !trip.deleted_at &&
      !trip.shared_session_id &&
      trip.status === 'active',
  );
}

/**
 * Block only when the live outing is linked to a *different* session than the one we're joining.
 * Same session = already in this group (not a blocker). Stale local `shared_session_id` is
 * reconciled on the link screen via `fetchTripById`.
 */
export function hasActiveTripBlockingSessionJoin(
  trip: Trip | null | undefined,
  targetSessionId: string | null | undefined,
): boolean {
  if (!trip || trip.deleted_at || trip.status !== 'active') return false;
  const sid = trip.shared_session_id?.trim() || null;
  if (!sid) return false;
  const target = targetSessionId?.trim() || null;
  if (target && sid === target) return false;
  return true;
}
