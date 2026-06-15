/**
 * WS-G — Retention notification orchestration (NATIVE-adjacent; bridges the pure
 * decision modules to the native scheduler in pushNotifications.ts).
 *
 * Pure math lives in src/utils/*; this file decides WHEN to actually fire/
 * schedule given live app state. Kept thin and side-effecting so the testable
 * logic stays in the pure modules.
 */
import {
  presentLocalNotification,
  scheduleLocalReminder,
  scheduleLocalReminders,
} from '@/src/services/pushNotifications';
import {
  computeMonthlyRecap,
  computeWeeksFishedStreak,
  computeSpeciesMilestone,
  type MilestoneCatch,
  type StreakTrip,
} from '@/src/utils/streaksMilestones';
import {
  planLogCatchesNudge,
  planTripReminders,
  type PlannedTripInput,
} from '@/src/utils/tripReminders';

/**
 * Schedule local reminders for the user's upcoming planned trips. Idempotent —
 * scheduleLocalReminder cancels any prior copy with the same key.
 */
export async function scheduleTripReminders(trips: PlannedTripInput[]): Promise<void> {
  const decisions = planTripReminders(trips);
  await scheduleLocalReminders(decisions);
}

/** Schedule the post-trip "log your catches" nudge when a trip completes. */
export async function schedulePostTripNudge(
  tripId: string,
  tripStartMs: number,
): Promise<void> {
  const decision = planLogCatchesNudge(tripId, tripStartMs);
  if (decision) await scheduleLocalReminder(decision);
}

/**
 * Evaluate streaks/milestones and fire local notifications when warranted:
 *  - streak-at-risk: nudge to keep the weeks-fished streak alive.
 *  - new species milestone: celebrate a freshly-crossed threshold.
 * Returns what (if anything) was fired, for callers / debugging.
 */
export async function maybeNotifyStreaksAndMilestones(
  trips: StreakTrip[],
  catches: MilestoneCatch[],
  now: number = Date.now(),
): Promise<{ firedStreakAtRisk: boolean; firedMilestone: boolean }> {
  let firedStreakAtRisk = false;
  let firedMilestone = false;

  const streak = computeWeeksFishedStreak(trips, now);
  if (streak.atRisk && streak.current > 0) {
    await presentLocalNotification(
      'Keep your streak alive',
      `You've fished ${streak.current} week${streak.current === 1 ? '' : 's'} in a row. Get out before the week ends.`,
      { type: 'stats' },
    );
    firedStreakAtRisk = true;
  }

  const milestone = computeSpeciesMilestone(catches, now);
  if (milestone.justCrossed && milestone.crossedThreshold != null) {
    await presentLocalNotification(
      'New milestone unlocked',
      `You've now landed ${milestone.crossedThreshold} different species. Nice work.`,
      { type: 'stats' },
    );
    firedMilestone = true;
  }

  return { firedStreakAtRisk, firedMilestone };
}

/** Fire the monthly recap as a local notification. */
export async function notifyMonthlyRecap(
  trips: StreakTrip[],
  catches: MilestoneCatch[],
  forMonthMs: number = Date.now(),
): Promise<void> {
  const recap = computeMonthlyRecap(trips, catches, forMonthMs);
  if (recap.trips === 0 && recap.fish === 0) return; // nothing to celebrate
  const bits = [`${recap.trips} trip${recap.trips === 1 ? '' : 's'}`, `${recap.fish} fish`];
  if (recap.distinctSpecies > 0) bits.push(`${recap.distinctSpecies} species`);
  await presentLocalNotification('Your month on the water', bits.join(' · '), {
    type: 'stats',
  });
}
