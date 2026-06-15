import { describe, expect, it } from 'vitest';
import {
  computeMonthlyRecap,
  computePersonalBests,
  computeSpeciesMilestone,
  computeWeeksFishedStreak,
  summarizeStreaksAndMilestones,
  weekIndexUtc,
  STREAK_AT_RISK_DAYS_LEFT,
  type MilestoneCatch,
  type StreakTrip,
} from './streaksMilestones';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

// A fixed Wednesday so "this week" math is stable. 2026-06-10 is a Wednesday.
const WED = Date.parse('2026-06-10T12:00:00Z');

function isoDaysAgo(now: number, days: number): string {
  return new Date(now - days * DAY).toISOString();
}

describe('weekIndexUtc', () => {
  it('groups days in the same Monday-start week together', () => {
    const mon = Date.parse('2026-06-08T00:00:00Z');
    const sun = Date.parse('2026-06-14T23:00:00Z');
    expect(weekIndexUtc(mon)).toBe(weekIndexUtc(sun));
  });

  it('separates adjacent weeks', () => {
    const sun = Date.parse('2026-06-07T12:00:00Z'); // prev week
    const mon = Date.parse('2026-06-08T12:00:00Z'); // this week
    expect(weekIndexUtc(mon)).toBe(weekIndexUtc(sun) + 1);
  });
});

describe('computeWeeksFishedStreak', () => {
  it('counts consecutive weeks including the current one', () => {
    const trips: StreakTrip[] = [
      { date: isoDaysAgo(WED, 0) }, // this week
      { date: isoDaysAgo(WED, 8) }, // last week
      { date: isoDaysAgo(WED, 15) }, // two weeks ago
    ];
    const r = computeWeeksFishedStreak(trips, WED);
    expect(r.current).toBe(3);
    expect(r.longest).toBe(3);
    expect(r.atRisk).toBe(false);
  });

  it('does not break the streak when the current week is empty but counts prior run', () => {
    const trips: StreakTrip[] = [
      { date: isoDaysAgo(WED, 8) }, // last week
      { date: isoDaysAgo(WED, 15) }, // two weeks ago
    ];
    const r = computeWeeksFishedStreak(trips, WED);
    expect(r.current).toBe(2);
  });

  it('ignores future/planned trips', () => {
    const trips: StreakTrip[] = [{ date: new Date(WED + 3 * DAY).toISOString() }];
    const r = computeWeeksFishedStreak(trips, WED);
    expect(r.current).toBe(0);
  });

  it('flags at-risk when this week is empty and the week is nearly over', () => {
    // Place "now" so only ~2 days remain in the week and last week was fished.
    const sat = Date.parse('2026-06-13T12:00:00Z'); // Saturday, ~1.5d left
    const trips: StreakTrip[] = [{ date: isoDaysAgo(sat, 8) }];
    const r = computeWeeksFishedStreak(trips, sat);
    expect(r.current).toBe(1);
    expect(r.atRisk).toBe(true);
  });

  it('is not at risk early in the week with days to spare', () => {
    const tue = Date.parse('2026-06-09T12:00:00Z');
    const trips: StreakTrip[] = [{ date: isoDaysAgo(tue, 8) }];
    const r = computeWeeksFishedStreak(tue ? trips : trips, tue);
    expect(r.atRisk).toBe(false);
    // sanity: there really are more than the at-risk threshold of days left
    const daysLeft = (weekIndexUtc(tue) + 1) * WEEK - 3 * DAY - tue;
    expect(daysLeft / DAY).toBeGreaterThan(STREAK_AT_RISK_DAYS_LEFT);
  });
});

describe('computePersonalBests', () => {
  it('finds biggest by size and weight independently', () => {
    const catches: MilestoneCatch[] = [
      { date: isoDaysAgo(WED, 1), species: 'Brown', sizeInches: 14, weightLb: 1.2 },
      { date: isoDaysAgo(WED, 2), species: 'Rainbow', sizeInches: 20, weightLb: 3 },
      { date: isoDaysAgo(WED, 3), species: 'Brook', sizeInches: 10, weightLb: 4.5 },
    ];
    const r = computePersonalBests(catches);
    expect(r.biggestBySizeInches).toBe(20);
    expect(r.biggestSpecies).toBe('Rainbow');
    expect(r.biggestByWeightLb).toBe(4.5);
  });

  it('returns nulls for empty input', () => {
    expect(computePersonalBests([])).toEqual({
      biggestBySizeInches: null,
      biggestByWeightLb: null,
      biggestSpecies: null,
    });
  });
});

describe('computeSpeciesMilestone', () => {
  it('reports highest threshold reached', () => {
    const catches: MilestoneCatch[] = ['a', 'b', 'c', 'd', 'e'].map((sp, i) => ({
      date: isoDaysAgo(WED, 30 + i),
      species: sp,
    }));
    const r = computeSpeciesMilestone(catches, WED);
    expect(r.distinctSpecies).toBe(5);
    expect(r.crossedThreshold).toBe(5);
    expect(r.justCrossed).toBe(false); // all old
  });

  it('detects a just-crossed milestone from a recent catch', () => {
    const old: MilestoneCatch[] = ['a', 'b', 'c', 'd'].map((sp, i) => ({
      date: isoDaysAgo(WED, 30 + i),
      species: sp,
    }));
    const fresh: MilestoneCatch = { date: isoDaysAgo(WED, 0), species: 'e' };
    const r = computeSpeciesMilestone([...old, fresh], WED);
    expect(r.distinctSpecies).toBe(5);
    expect(r.crossedThreshold).toBe(5);
    expect(r.justCrossed).toBe(true);
  });

  it('treats species case-insensitively and ignores blanks', () => {
    const catches: MilestoneCatch[] = [
      { date: isoDaysAgo(WED, 1), species: 'Brown' },
      { date: isoDaysAgo(WED, 2), species: 'brown' },
      { date: isoDaysAgo(WED, 3), species: '  ' },
      { date: isoDaysAgo(WED, 4), species: null },
    ];
    const r = computeSpeciesMilestone(catches, WED);
    expect(r.distinctSpecies).toBe(1);
    expect(r.crossedThreshold).toBeNull();
  });
});

describe('computeMonthlyRecap', () => {
  it('counts trips/fish/species within the reference month', () => {
    const june = Date.parse('2026-06-15T00:00:00Z');
    const trips: StreakTrip[] = [
      { date: '2026-06-02T10:00:00Z' },
      { date: '2026-06-20T10:00:00Z' },
      { date: '2026-05-30T10:00:00Z' }, // prior month, excluded
    ];
    const catches: MilestoneCatch[] = [
      { date: '2026-06-02T11:00:00Z', species: 'Brown', sizeInches: 12 },
      { date: '2026-06-20T11:00:00Z', species: 'Rainbow', sizeInches: 18 },
      { date: '2026-07-01T11:00:00Z', species: 'Brook', sizeInches: 22 }, // next month
    ];
    const r = computeMonthlyRecap(trips, catches, june);
    expect(r.month).toBe(5); // June (0-indexed)
    expect(r.year).toBe(2026);
    expect(r.trips).toBe(2);
    expect(r.fish).toBe(2);
    expect(r.distinctSpecies).toBe(2);
    expect(r.biggestSizeInches).toBe(18);
  });
});

describe('summarizeStreaksAndMilestones', () => {
  it('bundles all three computations', () => {
    const r = summarizeStreaksAndMilestones(
      [{ date: isoDaysAgo(WED, 0) }],
      [{ date: isoDaysAgo(WED, 0), species: 'Brown', sizeInches: 15 }],
      WED,
    );
    expect(r.streak.current).toBe(1);
    expect(r.personalBests.biggestBySizeInches).toBe(15);
    expect(r.speciesMilestone.distinctSpecies).toBe(1);
  });
});
