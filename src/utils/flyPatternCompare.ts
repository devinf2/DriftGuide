import type { NextFlyRecommendation } from '@/src/types';

/**
 * Normalize a fly label for comparison: ignore hook size (#16) and parenthetical color.
 * Used so "Adams #16 (Purple)" matches pattern "Adams".
 */
export function normalizeFlyPatternKey(input: string | null | undefined): string {
  if (input == null) return '';
  let s = String(input).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  s = s.replace(/\s*#\s*\d{1,2}\s*/g, ' ');
  s = s.replace(/\b(?:sz|size)\s*[.:]?\s*\d{1,2}\b/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function flyPatternsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = normalizeFlyPatternKey(a);
  const kb = normalizeFlyPatternKey(b);
  if (!ka || !kb) return false;
  return ka === kb;
}

/** True if "try next" repeats a fly already on the angler's rig (primary or dropper), ignoring size/color. */
export function nextFlyRecommendationConflictsCurrent(
  rec: Pick<NextFlyRecommendation, 'pattern' | 'pattern2'>,
  currentPrimaryLabel: string | null,
  currentSecondaryLabel: string | null,
): boolean {
  const curP = normalizeFlyPatternKey(currentPrimaryLabel);
  const curS = normalizeFlyPatternKey(currentSecondaryLabel);
  const recP = normalizeFlyPatternKey(rec.pattern);
  if (curP && recP === curP) return true;
  if (rec.pattern2) {
    const recS = normalizeFlyPatternKey(rec.pattern2);
    if (curS && recS === curS) return true;
  }
  return false;
}
