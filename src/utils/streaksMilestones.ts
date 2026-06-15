/**
 * WS-G — Streaks & milestones (PURE module, no native / React deps).
 *
 * Computes retention signals from a user's trip + catch history so the home
 * screen can render a "you're on a streak / new personal best" card and the
 * app can fire local notifications (streak-at-risk, new milestone, monthly
 * recap). Everything here is deterministic and unit-tested in
 * streaksMilestones.test.ts — keep it free of imports that pull in native
 * modules (expo-*) or stores.
 *
 * Inputs are intentionally minimal/plain so callers can adapt their richer
 * domain types (Trip, TripEvent, CatchData) down to these shapes without this
 * module depending on src/types.
 */

/** A single fishing trip, reduced to what streak/milestone math needs. */
export interface StreakTrip {
  /** ISO timestamp the trip happened (start_time, or planned_date for planned). */
  date: string;
}

/** A single landed fish, reduced to what milestone math needs. */
export interface MilestoneCatch {
  /** ISO timestamp of the catch event. */
  date: string;
  /** Species name (case-insensitive); null/empty = unknown. */
  species: string | null;
  /** Length in inches, if recorded. */
  sizeInches?: number | null;
  /** Weight in pounds, if recorded. */
  weightLb?: number | null;
}

/** ----------------------------- Constants ----------------------------- */

/** ms in one day / week — used for week-bucketing and recap windows. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * Species-count milestone thresholds. Hitting one of these distinct-species
 * counts surfaces a "species milestone" badge + push.
 */
export const SPECIES_MILESTONE_THRESHOLDS = [3, 5, 10, 15, 25] as const;

/**
 * A weeks-fished streak is "at risk" when the current ISO week has no trip yet
 * and we are within this many days of the week ending — i.e. nudge near the
 * weekend so the user has time to act.
 */
export const STREAK_AT_RISK_DAYS_LEFT = 3;

/** ----------------------------- Week helpers ----------------------------- */

/**
 * UTC week index (Monday-start) for an instant. Two dates share a week iff they
 * return the same integer. Monday-start keeps weekends inside the same bucket.
 */
export function weekIndexUtc(ms: number): number {
  // Shift so the epoch (Thu 1970-01-01) lands on a Monday boundary, then floor.
  const shifted = ms + 3 * MS_PER_DAY; // Thu -> Mon alignment
  return Math.floor(shifted / MS_PER_WEEK);
}

/** ----------------------------- Streak ----------------------------- */

export interface WeeksFishedStreak {
  /** Consecutive ISO weeks (ending at/just-before `now`) with >= 1 trip. */
  current: number;
  /** Longest such run anywhere in history. */
  longest: number;
  /** True when the current week has no trip and the week is nearly over. */
  atRisk: boolean;
}

/**
 * Weeks-fished streak: count of consecutive weeks (up to the current week) that
 * each contain at least one trip. The current week not yet having a trip does
 * NOT immediately break the streak (you still have time) — instead it flags
 * `atRisk` once we're within {@link STREAK_AT_RISK_DAYS_LEFT} of week-end.
 */
export function computeWeeksFishedStreak(
  trips: StreakTrip[],
  now: number = Date.now(),
): WeeksFishedStreak {
  const weeks = new Set<number>();
  for (const t of trips) {
    const ms = Date.parse(t.date);
    if (Number.isNaN(ms)) continue;
    if (ms > now) continue; // ignore future/planned trips
    weeks.add(weekIndexUtc(ms));
  }

  const thisWeek = weekIndexUtc(now);
  const fishedThisWeek = weeks.has(thisWeek);

  // Current streak: walk backwards from this week (or last week if this week is
  // still empty) while each week is present.
  let current = 0;
  let cursor = fishedThisWeek ? thisWeek : thisWeek - 1;
  while (weeks.has(cursor)) {
    current += 1;
    cursor -= 1;
  }

  // Longest streak: scan all weeks sorted ascending for the longest run.
  const sorted = [...weeks].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const w of sorted) {
    run = prev !== null && w === prev + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = w;
  }

  // At risk only when there IS a streak to protect, this week is empty, and the
  // week is nearly over.
  const weekEnd = (thisWeek + 1) * MS_PER_WEEK - 3 * MS_PER_DAY; // start of next week
  const daysLeft = (weekEnd - now) / MS_PER_DAY;
  const atRisk =
    current > 0 && !fishedThisWeek && daysLeft <= STREAK_AT_RISK_DAYS_LEFT && daysLeft >= 0;

  return { current, longest, atRisk };
}

/** ----------------------------- Personal bests ----------------------------- */

export interface PersonalBests {
  /** Longest fish on record (inches), or null. */
  biggestBySizeInches: number | null;
  /** Heaviest fish on record (lb), or null. */
  biggestByWeightLb: number | null;
  /** Species of the longest fish, if known. */
  biggestSpecies: string | null;
}

export function computePersonalBests(catches: MilestoneCatch[]): PersonalBests {
  let biggestBySizeInches: number | null = null;
  let biggestByWeightLb: number | null = null;
  let biggestSpecies: string | null = null;

  for (const c of catches) {
    if (c.sizeInches != null && Number.isFinite(c.sizeInches)) {
      if (biggestBySizeInches == null || c.sizeInches > biggestBySizeInches) {
        biggestBySizeInches = c.sizeInches;
        biggestSpecies = c.species?.trim() || null;
      }
    }
    if (c.weightLb != null && Number.isFinite(c.weightLb)) {
      if (biggestByWeightLb == null || c.weightLb > biggestByWeightLb) {
        biggestByWeightLb = c.weightLb;
      }
    }
  }

  return { biggestBySizeInches, biggestByWeightLb, biggestSpecies };
}

/**
 * Returns the highest species-count milestone the user has reached and whether
 * the most recent catch (within `recentWindowMs`) is what crossed it — so the
 * caller can decide to fire a "new milestone" push only when it's freshly
 * earned. `crossedThreshold` is null when no milestone has been reached.
 */
export interface SpeciesMilestoneResult {
  distinctSpecies: number;
  /** Highest threshold reached (e.g. 5, 10), or null. */
  crossedThreshold: number | null;
  /** True when the latest catch is the one that crossed `crossedThreshold`. */
  justCrossed: boolean;
}

export function computeSpeciesMilestone(
  catches: MilestoneCatch[],
  now: number = Date.now(),
  recentWindowMs: number = MS_PER_DAY,
): SpeciesMilestoneResult {
  // Distinct species seen overall.
  const seen = new Set<string>();
  // Distinct species excluding any caught only inside the recent window —
  // lets us detect a species that pushed the count over a threshold "just now".
  const seenBefore = new Set<string>();

  for (const c of catches) {
    const sp = c.species?.trim().toLowerCase();
    if (!sp) continue;
    seen.add(sp);
    const ms = Date.parse(c.date);
    const recent = !Number.isNaN(ms) && now - ms <= recentWindowMs && ms <= now;
    if (!recent) seenBefore.add(sp);
  }

  const distinctSpecies = seen.size;
  const crossedThreshold = highestThresholdReached(distinctSpecies);
  const priorThreshold = highestThresholdReached(seenBefore.size);
  const justCrossed = crossedThreshold != null && crossedThreshold !== priorThreshold;

  return { distinctSpecies, crossedThreshold, justCrossed };
}

function highestThresholdReached(count: number): number | null {
  let best: number | null = null;
  for (const t of SPECIES_MILESTONE_THRESHOLDS) {
    if (count >= t) best = t;
  }
  return best;
}

/** ----------------------------- Monthly recap ----------------------------- */

export interface MonthlyRecap {
  /** Calendar month (0-11) the recap covers, in UTC. */
  month: number;
  /** Calendar year the recap covers. */
  year: number;
  trips: number;
  fish: number;
  distinctSpecies: number;
  /** Biggest fish (inches) landed that month, or null. */
  biggestSizeInches: number | null;
}

/**
 * Recap of the calendar month that `forMonthMs` falls in (UTC). Used for the
 * monthly recap push and an in-app summary. Counts trips + catches whose
 * timestamps land inside that month.
 */
export function computeMonthlyRecap(
  trips: StreakTrip[],
  catches: MilestoneCatch[],
  forMonthMs: number = Date.now(),
): MonthlyRecap {
  const ref = new Date(forMonthMs);
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth();

  const inMonth = (iso: string): boolean => {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return false;
    const d = new Date(ms);
    return d.getUTCFullYear() === year && d.getUTCMonth() === month;
  };

  const monthTrips = trips.filter((t) => inMonth(t.date));
  const monthCatches = catches.filter((c) => inMonth(c.date));

  const species = new Set<string>();
  let biggestSizeInches: number | null = null;
  for (const c of monthCatches) {
    const sp = c.species?.trim().toLowerCase();
    if (sp) species.add(sp);
    if (c.sizeInches != null && Number.isFinite(c.sizeInches)) {
      if (biggestSizeInches == null || c.sizeInches > biggestSizeInches) {
        biggestSizeInches = c.sizeInches;
      }
    }
  }

  return {
    month,
    year,
    trips: monthTrips.length,
    fish: monthCatches.length,
    distinctSpecies: species.size,
    biggestSizeInches,
  };
}

/** ----------------------------- Aggregate ----------------------------- */

export interface StreakMilestoneSummary {
  streak: WeeksFishedStreak;
  personalBests: PersonalBests;
  speciesMilestone: SpeciesMilestoneResult;
}

/** Convenience: everything the home card needs in one call. */
export function summarizeStreaksAndMilestones(
  trips: StreakTrip[],
  catches: MilestoneCatch[],
  now: number = Date.now(),
): StreakMilestoneSummary {
  return {
    streak: computeWeeksFishedStreak(trips, now),
    personalBests: computePersonalBests(catches),
    speciesMilestone: computeSpeciesMilestone(catches, now),
  };
}
