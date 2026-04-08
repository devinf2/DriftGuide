import type { Trip } from '@/src/types';

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
