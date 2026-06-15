/**
 * Offline feature-key narrowing for the Bug Matcher (WS-F).
 *
 * Pure functions over the INSECTS dataset so the screen and tests share one
 * implementation. Each filter is optional; an unset filter does not constrain.
 * Size is a range overlap (insect span vs. selected hook bucket) so a bug that
 * spans #16–22 still matches both the "small" and "tiny" buckets.
 */

import {
  INSECTS,
  SIZE_BUCKETS,
  type Insect,
  type InsectBodyColor,
  type InsectLifeStage,
  type InsectProfile,
  type SizeBucket,
} from '@/src/data/insects';
import type { HatchCategory } from '@/src/data/driftGuideHatchChart';

export type BugMatcherFilters = {
  category?: HatchCategory | null;
  size?: SizeBucket | null;
  color?: InsectBodyColor | null;
  profile?: InsectProfile | null;
  lifeStage?: InsectLifeStage | null;
};

/** True when the insect's hook span overlaps the selected size bucket span. */
function matchesSize(insect: Insect, bucket: SizeBucket): boolean {
  const b = SIZE_BUCKETS.find((x) => x.key === bucket);
  if (!b) return true;
  // Smaller hook number = bigger bug; treat both as plain numeric ranges and test overlap.
  return insect.sizeRange.minHook <= b.maxHook && insect.sizeRange.maxHook >= b.minHook;
}

/** Narrow the dataset by the provided feature filters (any subset). */
export function filterInsects(filters: BugMatcherFilters, source: Insect[] = INSECTS): Insect[] {
  return source.filter((insect) => {
    if (filters.category && insect.category !== filters.category) return false;
    if (filters.size && !matchesSize(insect, filters.size)) return false;
    if (filters.color && !insect.bodyColors.includes(filters.color)) return false;
    if (filters.profile && !insect.profiles.includes(filters.profile)) return false;
    if (filters.lifeStage && !insect.lifeStages.includes(filters.lifeStage)) return false;
    return true;
  });
}

/** Distinct categories present in the dataset (for the first filter step). */
export function availableCategories(source: Insect[] = INSECTS): HatchCategory[] {
  const seen: HatchCategory[] = [];
  for (const insect of source) {
    if (!seen.includes(insect.category)) seen.push(insect.category);
  }
  return seen;
}

/** Size buckets that still have at least one candidate given the current filters (excluding size itself). */
export function availableSizeBuckets(filters: BugMatcherFilters): SizeBucket[] {
  const base = filterInsects({ ...filters, size: null });
  return SIZE_BUCKETS.filter((b) => base.some((i) => matchesSize(i, b.key))).map((b) => b.key);
}

/** Body colors present among candidates given current filters (excluding color itself). */
export function availableColors(filters: BugMatcherFilters): InsectBodyColor[] {
  const base = filterInsects({ ...filters, color: null });
  const seen: InsectBodyColor[] = [];
  for (const insect of base) {
    for (const c of insect.bodyColors) if (!seen.includes(c)) seen.push(c);
  }
  return seen;
}

/** Profiles present among candidates given current filters (excluding profile itself). */
export function availableProfiles(filters: BugMatcherFilters): InsectProfile[] {
  const base = filterInsects({ ...filters, profile: null });
  const seen: InsectProfile[] = [];
  for (const insect of base) {
    for (const p of insect.profiles) if (!seen.includes(p)) seen.push(p);
  }
  return seen;
}

/** Life stages present among candidates given current filters (excluding life stage itself). */
export function availableLifeStages(filters: BugMatcherFilters): InsectLifeStage[] {
  const base = filterInsects({ ...filters, lifeStage: null });
  const seen: InsectLifeStage[] = [];
  for (const insect of base) {
    for (const s of insect.lifeStages) if (!seen.includes(s)) seen.push(s);
  }
  return seen;
}

/** Find an insect by id (used to map AI results / candidate taps back to the dataset). */
export function insectById(id: string): Insect | undefined {
  return INSECTS.find((i) => i.id === id);
}
