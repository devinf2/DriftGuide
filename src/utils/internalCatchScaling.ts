/**
 * Scale how much community/internal catch logs should influence scores and copy.
 * N = fish-equivalent count in the lookback window for a location (sum of quantity).
 */

export function internalSampleConfidenceN(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n === 1) return 0.2;
  if (n < 5) return 0.35;
  if (n < 10) return 0.55;
  if (n < 25) return 0.75;
  return 1;
}

/** Effective internal pillar value after sample-size dampening. */
export function internalPillarEffective(iRaw: number, n: number): number {
  const s = internalSampleConfidenceN(n);
  if (s == null) return 0;
  return Math.max(0, Math.min(1, iRaw)) * s;
}

export function internalCatchScalingNote(n: number): string {
  if (n <= 0) return '';
  if (n === 1) {
    return 'Internal scaling: app catch sample in window is a single anecdote—do not cite counts; use only for very weak tie-breaks.';
  }
  if (n < 5) {
    return 'Internal scaling: app catch sample is thin—rank cautiously; never quote totals or N to the angler.';
  }
  if (n < 10) {
    return 'Internal scaling: app catch sample is modest—blend with conditions and reports; never quote specific totals to the angler.';
  }
  return 'Internal scaling: app catch sample is stronger—still never quote database numbers to the angler.';
}
