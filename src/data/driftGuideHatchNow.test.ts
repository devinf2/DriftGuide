import { describe, expect, it } from 'vitest';
import {
  DRIFTGUIDE_HATCH_CHART_ENTRIES,
  bestWindowLabel,
  daypartKeyForHour,
  hatchDaypartShare,
  pickNowHatch,
  primaryFlyForHatch,
  type DriftGuideHatchChartEntry,
} from './driftGuideHatchChart';

const byId = (id: string): DriftGuideHatchChartEntry => {
  const e = DRIFTGUIDE_HATCH_CHART_ENTRIES.find((x) => x.id === id);
  if (!e) throw new Error(`missing hatch ${id}`);
  return e;
};

const JULY = 6; // 0-based month index

describe('daypartKeyForHour', () => {
  it.each([
    [6, 'dawn'],
    [9, 'morning'],
    [12, 'midday'],
    [15, 'afternoon'],
    [19, 'evening'],
    [23, 'night'],
    [3, 'night'],
  ] as const)('hour %i → %s', (hour, key) => {
    expect(daypartKeyForHour(hour)).toBe(key);
  });

  it('wraps out-of-range hours', () => {
    expect(daypartKeyForHour(-1)).toBe('night'); // 23:00
    expect(daypartKeyForHour(30)).toBe('dawn'); // 06:00
  });
});

describe('bestWindowLabel', () => {
  it('widens to a strong adjacent neighbor', () => {
    expect(bestWindowLabel(byId('trico').daypart)).toBe('Dawn–Morning');
    expect(bestWindowLabel(byId('terrestrial').daypart)).toBe('Midday–Afternoon');
    expect(bestWindowLabel(byId('caddis').daypart)).toBe('Afternoon–Evening');
  });

  it('reports a single peak window when one part clearly dominates', () => {
    expect(bestWindowLabel(byId('skwala').daypart)).toBe('Midday');
    expect(bestWindowLabel(byId('march-brown').daypart)).toBe('Midday');
  });
});

describe('pickNowHatch', () => {
  it('features the prime hatch most active at the current hour', () => {
    // July morning → Tricos (prime, spinner fall peaks dawn/morning).
    expect(pickNowHatch(DRIFTGUIDE_HATCH_CHART_ENTRIES, JULY, 9)?.id).toBe('trico');
    // July evening → Green Drake (prime, evening-weighted).
    expect(pickNowHatch(DRIFTGUIDE_HATCH_CHART_ENTRIES, JULY, 19)?.id).toBe('green-drake');
  });

  it('falls to the highest available tier when nothing is prime', () => {
    // February: no prime hatches; midge is good (level 2) and should be featured.
    const feb = pickNowHatch(DRIFTGUIDE_HATCH_CHART_ENTRIES, 1, 12);
    expect(feb?.id).toBe('midge');
  });
});

describe('hatchDaypartShare + primaryFlyForHatch', () => {
  it('normalizes daypart weight to a 0–1 share', () => {
    // Trico: morning 35 of 100 total.
    expect(hatchDaypartShare(byId('trico'), 'morning')).toBeCloseTo(0.35, 5);
  });

  it('prefers the first dry pattern as the tie-on fly', () => {
    expect(primaryFlyForHatch(byId('trico'))?.name).toBe('Trico');
    expect(primaryFlyForHatch(byId('trico'))?.stage).toBe('dry');
  });
});
