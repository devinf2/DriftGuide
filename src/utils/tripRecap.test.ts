import { describe, expect, it } from 'vitest';
import type { CatchData, TripEvent } from '@/src/types';
import { buildTripRecap, catchesBySizeDesc, formatHourWindowLabel } from '@/src/utils/tripRecap';

function catchEvent(
  id: string,
  timestamp: string,
  data: Partial<CatchData>,
  conditions?: TripEvent['conditions_snapshot'],
): TripEvent {
  return {
    id,
    trip_id: 't1',
    event_type: 'catch',
    timestamp,
    data: {
      species: null,
      size_inches: null,
      note: null,
      photo_url: null,
      active_fly_event_id: null,
      ...data,
    } as CatchData,
    conditions_snapshot: conditions ?? null,
    latitude: null,
    longitude: null,
  };
}

function noteEvent(id: string, timestamp: string, text: string): TripEvent {
  return {
    id,
    trip_id: 't1',
    event_type: 'note',
    timestamp,
    data: { text },
    conditions_snapshot: null,
    latitude: null,
    longitude: null,
  };
}

describe('buildTripRecap', () => {
  it('picks the biggest catch by length, then weight', () => {
    const events = [
      catchEvent('a', '2026-06-21T19:00:00Z', { species: 'Brown Trout', size_inches: 14 }),
      catchEvent('b', '2026-06-21T19:30:00Z', { species: 'Brown Trout', size_inches: 18 }),
      catchEvent('c', '2026-06-21T20:00:00Z', { species: 'Rainbow', size_inches: 12 }),
    ];
    const recap = buildTripRecap(events);
    expect(recap.biggest?.event.id).toBe('b');
    expect(recap.biggest?.sizeInches).toBe(18);
    expect(recap.biggest?.species).toBe('Brown Trout');
  });

  it('breaks length ties by weight without ever crossing an inch', () => {
    const events = [
      catchEvent('a', '2026-06-21T19:00:00Z', { species: 'A', size_inches: 16, weight_lb: 1 }),
      catchEvent('b', '2026-06-21T19:30:00Z', { species: 'B', size_inches: 16, weight_lb: 2, weight_oz: 4 }),
      // A shorter but heavier fish must NOT outrank a longer one.
      catchEvent('c', '2026-06-21T20:00:00Z', { species: 'C', size_inches: 15, weight_lb: 9 }),
    ];
    expect(buildTripRecap(events).biggest?.event.id).toBe('b');
  });

  it('returns no biggest when there are no catches', () => {
    expect(buildTripRecap([noteEvent('n', '2026-06-21T18:00:00Z', 'Trip started')]).biggest).toBeNull();
  });

  it('finds the hot hour only when a window clears 2 fish', () => {
    const events = [
      catchEvent('a', '2026-06-21T19:05:00', { size_inches: 10 }),
      catchEvent('b', '2026-06-21T19:40:00', { size_inches: 11 }),
      catchEvent('c', '2026-06-21T19:55:00', { size_inches: 12 }),
      catchEvent('d', '2026-06-21T21:10:00', { size_inches: 9 }),
    ];
    const recap = buildTripRecap(events);
    expect(recap.hotHour).toEqual({ startHour: 19, count: 3 });
  });

  it('counts quantity toward the hot hour', () => {
    const events = [catchEvent('a', '2026-06-21T07:15:00', { size_inches: 8, quantity: 2 })];
    expect(buildTripRecap(events).hotHour).toEqual({ startHour: 7, count: 2 });
  });

  it('returns no hot hour when nothing clears the threshold', () => {
    const events = [
      catchEvent('a', '2026-06-21T19:05:00', { size_inches: 10 }),
      catchEvent('b', '2026-06-21T21:40:00', { size_inches: 11 }),
    ];
    expect(buildTripRecap(events).hotHour).toBeNull();
  });

  it('reads water from the most recent snapshot with flow data', () => {
    const early = {
      weather: null,
      captured_at: '2026-06-21T18:00:00Z',
      waterFlow: {
        station_id: 's', station_name: 'S', flow_cfs: 100, water_temp_f: 55,
        gage_height_ft: null, turbidity_ntu: null, clarity: 'stained' as const,
        clarity_source: 'sensor' as const, timestamp: '2026-06-21T18:00:00Z',
      },
    };
    const late = {
      ...early,
      captured_at: '2026-06-21T20:00:00Z',
      waterFlow: { ...early.waterFlow, flow_cfs: 71, water_temp_f: 58, clarity: 'clear' as const },
    };
    const events = [
      catchEvent('a', '2026-06-21T18:00:00Z', { size_inches: 10 }, early),
      catchEvent('b', '2026-06-21T20:00:00Z', { size_inches: 12 }, late),
    ];
    expect(buildTripRecap(events).water).toEqual({ tempF: 58, clarity: 'clear', flowCfs: 71 });
  });

  it('drops an unknown clarity to null', () => {
    const cond = {
      weather: null,
      captured_at: '2026-06-21T20:00:00Z',
      waterFlow: {
        station_id: 's', station_name: 'S', flow_cfs: 71, water_temp_f: 58,
        gage_height_ft: null, turbidity_ntu: null, clarity: 'unknown' as const,
        clarity_source: 'inferred' as const, timestamp: '2026-06-21T20:00:00Z',
      },
    };
    expect(buildTripRecap([catchEvent('a', '2026-06-21T20:00:00Z', { size_inches: 10 }, cond)]).water).toEqual({
      tempF: 58,
      clarity: null,
      flowCfs: 71,
    });
  });
});

describe('catchesBySizeDesc', () => {
  it('orders catches largest first and ignores non-catch events', () => {
    const events = [
      noteEvent('n', '2026-06-21T18:00:00Z', 'Trip started'),
      catchEvent('a', '2026-06-21T19:00:00Z', { size_inches: 12 }),
      catchEvent('b', '2026-06-21T19:30:00Z', { size_inches: 18 }),
    ];
    expect(catchesBySizeDesc(events).map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('formatHourWindowLabel', () => {
  it('collapses a shared period', () => {
    expect(formatHourWindowLabel(19)).toBe('7–8 PM');
    expect(formatHourWindowLabel(7)).toBe('7–8 AM');
  });

  it('keeps both periods across the AM/PM boundary', () => {
    expect(formatHourWindowLabel(11)).toBe('11 AM–12 PM');
    expect(formatHourWindowLabel(23)).toBe('11 PM–12 AM');
  });
});
