import { describe, expect, it } from 'vitest';
import {
  LOG_CATCHES_NUDGE_DELAY_HOURS,
  TRIP_REMINDER_LEAD_HOURS,
  planLogCatchesNudge,
  planTripReminders,
  type PlannedTripInput,
} from './tripReminders';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-06-15T12:00:00Z');

describe('planTripReminders', () => {
  it('schedules a reminder one lead-window before a future trip', () => {
    const startMs = NOW + 48 * HOUR;
    const trips: PlannedTripInput[] = [
      { id: 't1', date: new Date(startMs).toISOString(), label: 'Provo River' },
    ];
    const r = planTripReminders(trips, NOW);
    expect(r).toHaveLength(1);
    expect(r[0].key).toBe('trip_reminder_t1');
    expect(r[0].fireAtMs).toBe(startMs - TRIP_REMINDER_LEAD_HOURS * HOUR);
    expect(r[0].data).toEqual({ type: 'trip_reminder', tripId: 't1' });
    expect(r[0].body).toContain('Provo River');
  });

  it('skips trips whose lead window has already passed', () => {
    // Trip starts in 2 hours -> lead fire time is in the past.
    const trips: PlannedTripInput[] = [
      { id: 't2', date: new Date(NOW + 2 * HOUR).toISOString() },
    ];
    expect(planTripReminders(trips, NOW)).toHaveLength(0);
  });

  it('skips past trips and invalid dates', () => {
    const trips: PlannedTripInput[] = [
      { id: 't3', date: new Date(NOW - 5 * HOUR).toISOString() },
      { id: 't4', date: 'not-a-date' },
    ];
    expect(planTripReminders(trips, NOW)).toHaveLength(0);
  });

  it('falls back to a generic label when none given', () => {
    const trips: PlannedTripInput[] = [
      { id: 't5', date: new Date(NOW + 48 * HOUR).toISOString() },
    ];
    expect(planTripReminders(trips, NOW)[0].body).toContain('your trip');
  });
});

describe('planLogCatchesNudge', () => {
  it('schedules the nudge after the configured delay', () => {
    const startMs = NOW; // trip just started
    const r = planLogCatchesNudge('t1', startMs, NOW);
    expect(r).not.toBeNull();
    expect(r!.key).toBe('log_catches_t1');
    expect(r!.fireAtMs).toBe(startMs + LOG_CATCHES_NUDGE_DELAY_HOURS * HOUR);
    expect(r!.data).toEqual({ type: 'log_catches', tripId: 't1' });
  });

  it('returns null when the nudge time is already past', () => {
    const startMs = NOW - 24 * HOUR;
    expect(planLogCatchesNudge('t1', startMs, NOW)).toBeNull();
  });

  it('returns null for a non-finite start', () => {
    expect(planLogCatchesNudge('t1', Number.NaN, NOW)).toBeNull();
  });
});
