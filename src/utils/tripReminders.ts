/**
 * WS-G — Trip reminder scheduling decisions (PURE module, no native deps).
 *
 * Decides WHICH local notifications to schedule for planned trips and the
 * post-trip "log your catches" nudge. The native scheduler
 * (src/services/pushNotifications.ts) takes these decisions and calls
 * expo-notifications. Keeping the decisions pure makes them unit-testable
 * without the native module — see tripReminders.test.ts.
 */

/** A planned trip reduced to scheduling-relevant fields. */
export interface PlannedTripInput {
  id: string;
  /** ISO timestamp the trip is planned for (planned_date or start_time). */
  date: string;
  /** Display name for the body copy (location or "your trip"). */
  label?: string | null;
}

/** A scheduled local notification request the native layer will enqueue. */
export interface ReminderDecision {
  /** Stable identifier (so re-scheduling can cancel/replace). */
  key: string;
  title: string;
  body: string;
  /** When to fire (epoch ms). */
  fireAtMs: number;
  /** Routing payload, mirrors notification `data` (see useNotificationResponseRouting). */
  data: { type: 'trip_reminder' | 'log_catches'; tripId: string };
}

const MS_PER_HOUR = 60 * 60 * 1000;

/** Fire the pre-trip reminder this long before the planned start. */
export const TRIP_REMINDER_LEAD_HOURS = 18;

/** Fire the "log your catches" nudge this long after a trip's start. */
export const LOG_CATCHES_NUDGE_DELAY_HOURS = 6;

/**
 * Decide pre-trip reminders for the given planned trips. We only schedule a
 * reminder when its fire time is still in the future (lead time hasn't already
 * passed) — past/imminent trips are skipped so we never fire immediately.
 */
export function planTripReminders(
  trips: PlannedTripInput[],
  now: number = Date.now(),
): ReminderDecision[] {
  const out: ReminderDecision[] = [];
  for (const t of trips) {
    const startMs = Date.parse(t.date);
    if (Number.isNaN(startMs)) continue;
    const fireAtMs = startMs - TRIP_REMINDER_LEAD_HOURS * MS_PER_HOUR;
    if (fireAtMs <= now) continue; // lead window already gone (or trip is past)
    const label = t.label?.trim() || 'your trip';
    out.push({
      key: `trip_reminder_${t.id}`,
      title: 'Trip tomorrow',
      body: `Get ready for ${label}. Tap to review your plan.`,
      fireAtMs,
      data: { type: 'trip_reminder', tripId: t.id },
    });
  }
  return out;
}

/**
 * Decide the post-trip "log your catches" nudge for a trip that just started /
 * completed. Returns null when the nudge time would already be in the past
 * (caller can fire immediately or skip). `tripStartMs` is the trip's start.
 */
export function planLogCatchesNudge(
  tripId: string,
  tripStartMs: number,
  now: number = Date.now(),
): ReminderDecision | null {
  if (!Number.isFinite(tripStartMs)) return null;
  const fireAtMs = tripStartMs + LOG_CATCHES_NUDGE_DELAY_HOURS * MS_PER_HOUR;
  if (fireAtMs <= now) return null;
  return {
    key: `log_catches_${tripId}`,
    title: 'How did it go?',
    body: 'Log your catches while the details are fresh.',
    fireAtMs,
    data: { type: 'log_catches', tripId },
  };
}
