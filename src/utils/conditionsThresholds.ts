/**
 * WS-G — Conditions "good window" evaluation (PURE module, no native deps).
 *
 * Decides whether a water's current conditions are strong enough to be worth a
 * "conditions look good today" push. The conditions-alerts edge function
 * (supabase/functions/conditions-alerts/) mirrors these constants and the
 * evaluateConditions logic in Deno — keep the two in sync. Unit-tested in
 * conditionsThresholds.test.ts.
 *
 * The reduced ConditionsSnapshot shape matches the raw numbers the app already
 * pulls per spot (weather-proxy temp_f / wind_speed_mph; waterFlow flow_cfs /
 * water_temp_f / clarity), so both the client and the edge function can build
 * it from the same sources.
 */

export type WaterClarity =
  | 'clear'
  | 'slightly_stained'
  | 'stained'
  | 'murky'
  | 'blown_out'
  | 'unknown';

export interface ConditionsSnapshot {
  /** Air temperature, F. */
  tempF?: number | null;
  /** Sustained wind, mph. */
  windMph?: number | null;
  /** Streamflow, cubic feet/sec. */
  flowCfs?: number | null;
  /** Water temperature, F. */
  waterTempF?: number | null;
  clarity?: WaterClarity | null;
}

/**
 * Good-window thresholds. Conservative, generic trout-leaning defaults so we
 * only nudge on genuinely promising days (false positives erode push trust).
 */
export const CONDITIONS_THRESHOLDS = {
  /** Air temp sweet spot (inclusive). */
  AIR_TEMP_MIN_F: 45,
  AIR_TEMP_MAX_F: 80,
  /** Above this sustained wind, casting suffers — disqualify. */
  WIND_MAX_MPH: 15,
  /** Water-temp window where trout feed actively (inclusive). */
  WATER_TEMP_MIN_F: 42,
  WATER_TEMP_MAX_F: 67,
  /** Clarity values clear enough to fish well. */
  GOOD_CLARITY: ['clear', 'slightly_stained', 'stained'] as WaterClarity[],
  /** Blown-out / murky clarity disqualifies regardless of other factors. */
  BAD_CLARITY: ['murky', 'blown_out'] as WaterClarity[],
  /**
   * Score (0..n of positive signals) needed to fire a push. Requiring 2 means a
   * single nice metric isn't enough — multiple signals must align.
   */
  MIN_GOOD_SCORE: 2,
} as const;

export interface ConditionsEvaluation {
  /** True when the water clears the good-window bar. */
  isGoodWindow: boolean;
  /** Count of positive signals that aligned. */
  score: number;
  /** Human-readable reasons (for push body / debugging). */
  reasons: string[];
  /** A hard disqualifier was hit (e.g. blown out, gale wind). */
  disqualified: boolean;
}

/**
 * Evaluate a single water's snapshot against {@link CONDITIONS_THRESHOLDS}.
 * Hard disqualifiers (too windy, blown out) immediately return not-good; other
 * factors accumulate a score and must reach MIN_GOOD_SCORE.
 */
export function evaluateConditions(snap: ConditionsSnapshot): ConditionsEvaluation {
  const reasons: string[] = [];
  let score = 0;

  // --- Hard disqualifiers ---
  if (snap.windMph != null && snap.windMph > CONDITIONS_THRESHOLDS.WIND_MAX_MPH) {
    return { isGoodWindow: false, score: 0, reasons: ['too windy'], disqualified: true };
  }
  if (snap.clarity != null && CONDITIONS_THRESHOLDS.BAD_CLARITY.includes(snap.clarity)) {
    return { isGoodWindow: false, score: 0, reasons: ['water blown out'], disqualified: true };
  }

  // --- Positive signals ---
  if (
    snap.tempF != null &&
    snap.tempF >= CONDITIONS_THRESHOLDS.AIR_TEMP_MIN_F &&
    snap.tempF <= CONDITIONS_THRESHOLDS.AIR_TEMP_MAX_F
  ) {
    score += 1;
    reasons.push('comfortable air temp');
  }
  if (snap.windMph != null && snap.windMph <= CONDITIONS_THRESHOLDS.WIND_MAX_MPH) {
    score += 1;
    reasons.push('light wind');
  }
  if (
    snap.waterTempF != null &&
    snap.waterTempF >= CONDITIONS_THRESHOLDS.WATER_TEMP_MIN_F &&
    snap.waterTempF <= CONDITIONS_THRESHOLDS.WATER_TEMP_MAX_F
  ) {
    score += 1;
    reasons.push('ideal water temp');
  }
  if (snap.clarity != null && CONDITIONS_THRESHOLDS.GOOD_CLARITY.includes(snap.clarity)) {
    score += 1;
    reasons.push('good clarity');
  }

  const isGoodWindow = score >= CONDITIONS_THRESHOLDS.MIN_GOOD_SCORE;
  return { isGoodWindow, score, reasons, disqualified: false };
}

/** Build the push body for a good water. Kept here so tests can assert copy. */
export function conditionsPushBody(waterName: string): string {
  return `Conditions look strong on ${waterName} today — go fish it.`;
}
