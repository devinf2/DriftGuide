import { describe, expect, it } from 'vitest';
import {
  buildRightNowTake,
  chooseRecommendedFly,
  selectPrimeHatchesForMonth,
} from '@/src/utils/homeRightNow';

/**
 * Stub image predicate mirroring the bundled fly art the helper relies on. We don't import
 * flyImages here so the test stays free of bundler asset requires (png/jpg).
 */
const BUNDLED = new Set(
  [
    'Zebra Midge',
    'Griffiths Gnat',
    'Blue Wing Olive',
    'Comparadun',
    'Parachute Adams',
    'Adams',
    'Chubby Chernobyl',
    'Stimulator',
    'Yellow Sally',
    'Green Drake',
    'Trico',
    'Elk Hair Caddis',
    'X-Caddis',
    'Orange Stimulator',
    'Morrish Hopper',
    'Parachute Ant',
    'Pheasant Tail Nymph',
  ].map((n) => n.toLowerCase()),
);
const hasImage = (name: string) => BUNDLED.has(name.trim().toLowerCase());

describe('selectPrimeHatchesForMonth', () => {
  it('returns hatches scoring good-or-prime this month, strongest first', () => {
    // July (index 6): tricos, PMD, terrestrials, caddis etc. are strong.
    const july = selectPrimeHatchesForMonth(6, 5);
    expect(july.length).toBeGreaterThan(0);
    expect(july.every((h) => h.activity >= 2)).toBe(true);
    // sorted by activity descending
    for (let i = 1; i < july.length; i++) {
      expect(july[i - 1].activity).toBeGreaterThanOrEqual(july[i].activity);
    }
  });

  it('respects the limit', () => {
    expect(selectPrimeHatchesForMonth(6, 2).length).toBeLessThanOrEqual(2);
  });

  it('clamps out-of-range months instead of throwing', () => {
    expect(() => selectPrimeHatchesForMonth(-3)).not.toThrow();
    expect(() => selectPrimeHatchesForMonth(15)).not.toThrow();
  });

  it('always finds midges in winter (January)', () => {
    const jan = selectPrimeHatchesForMonth(0, 6);
    expect(jan.some((h) => h.entry.id === 'midge')).toBe(true);
  });
});

describe('chooseRecommendedFly', () => {
  it('chooses a bundled-art fly tied to the strongest hatch', () => {
    const prime = selectPrimeHatchesForMonth(6, 3);
    const fly = chooseRecommendedFly(prime, hasImage);
    expect(fly.name).toBeTruthy();
    // The recommendation must have a real image so the hero renders.
    expect(hasImage(fly.name)).toBe(true);
    expect(fly.forHatch?.id).toBe(prime[0].entry.id);
  });

  it('falls back to a generic fly with art when no prime hatches', () => {
    const fly = chooseRecommendedFly([], hasImage);
    expect(hasImage(fly.name)).toBe(true);
    expect(fly.forHatch).toBeUndefined();
  });
});

describe('buildRightNowTake', () => {
  const fly = { name: 'Adams' };

  it('mentions ranked waters when present', () => {
    const take = buildRightNowTake({
      rankedWatersCount: 3,
      primeHatches: selectPrimeHatchesForMonth(6, 3),
      recommendedFly: fly,
      hasLocation: true,
    });
    expect(take).toContain('Adams');
    expect(take.toLowerCase()).toContain('nearby waters');
  });

  it('reads usefully for a zero-data guest (no location, no waters)', () => {
    const take = buildRightNowTake({
      rankedWatersCount: 0,
      primeHatches: selectPrimeHatchesForMonth(6, 3),
      recommendedFly: fly,
      hasLocation: false,
    });
    expect(take).toContain('Adams');
    expect(take.toLowerCase()).toContain('location');
  });

  it('handles no hatch + no waters without dangling text', () => {
    const take = buildRightNowTake({
      rankedWatersCount: 0,
      primeHatches: [],
      recommendedFly: fly,
      hasLocation: false,
    });
    expect(take).toContain('Adams');
    expect(take.length).toBeGreaterThan(10);
  });
});
