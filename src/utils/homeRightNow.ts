import {
  DRIFTGUIDE_HATCH_CHART_ENTRIES,
  entriesStrongThisMonth,
  hatchActivityForMonth,
  type DriftGuideHatchChartEntry,
  type MonthActivity,
} from '@/src/data/driftGuideHatchChart';

/**
 * Pure helpers behind the home "Right now near you" module. These take no user data and
 * derive a useful answer ("what's hatching, what to tie on") from the in-app hatch chart
 * plus the current month/time — so the hero renders for a brand-new guest with zero input.
 *
 * Image availability is injected as a predicate so this stays free of bundler asset requires
 * (the component passes {@link getBundledFlyImageSource}); tests pass their own predicate.
 */

/** True when a fly name has displayable art. Defaults to "everything has art" for pure callers. */
export type HasFlyImage = (name: string) => boolean;

/** A hatch worth planning around this month, with its current activity level. */
export type PrimeHatch = {
  entry: DriftGuideHatchChartEntry;
  /** monthActivity for the selected month (2 = good, 3 = prime) */
  activity: MonthActivity;
};

/**
 * Prime hatches for the given month: entries scoring "good" (>=2) this month, strongest first,
 * capped at {@link limit}. Ties broken by name so output is stable.
 * 0-based month (Date.getMonth()).
 */
export function selectPrimeHatchesForMonth(
  monthIndex0: number,
  limit = 3,
  entries: DriftGuideHatchChartEntry[] = DRIFTGUIDE_HATCH_CHART_ENTRIES,
): PrimeHatch[] {
  return entriesStrongThisMonth(entries, monthIndex0, 2)
    .map((entry) => ({ entry, activity: hatchActivityForMonth(entry, monthIndex0) }))
    .sort((a, b) => b.activity - a.activity || a.entry.name.localeCompare(b.entry.name))
    .slice(0, Math.max(0, limit));
}

/**
 * Hatch chart id -> a representative bundled fly that imitates it. Only the first candidate
 * with a real bundled image is used; falls back to a generic searcher so we always have art.
 */
const HATCH_ID_TO_FLY_CANDIDATES: Record<string, string[]> = {
  midge: ['Zebra Midge', 'Griffiths Gnat'],
  bwo: ['Blue Wing Olive', 'Comparadun'],
  'march-brown': ['Parachute Adams', 'Adams'],
  skwala: ['Chubby Chernobyl', 'Stimulator'],
  salmonfly: ['Chubby Chernobyl', 'Stimulator'],
  golden: ['Yellow Sally', 'Stimulator'],
  pmd: ['Comparadun', 'Parachute Adams'],
  'green-drake': ['Green Drake', 'Parachute Adams'],
  trico: ['Trico', 'Griffiths Gnat'],
  caddis: ['Elk Hair Caddis', 'X-Caddis'],
  'oct-caddis': ['Orange Stimulator', 'Stimulator'],
  callibaetis: ['Parachute Adams', 'Comparadun'],
  terrestrial: ['Morrish Hopper', 'Parachute Ant'],
  mahogany: ['Parachute Adams', 'Comparadun'],
};

/** Last-resort patterns (all have bundled art) so the hero always shows a fly. */
const GENERIC_FLY_FALLBACKS = ['Pheasant Tail Nymph', 'Adams', 'Zebra Midge'];

/** First name in the list that has bundled art (per {@link hasImage}), else null. */
function firstFlyWithImage(names: string[], hasImage: HasFlyImage): string | null {
  for (const n of names) {
    if (hasImage(n)) return n;
  }
  return null;
}

export type RecommendedFly = {
  /** Display + image lookup name (matches a bundled fly image). */
  name: string;
  /** The hatch it ties to, when chosen from a prime hatch. */
  forHatch?: DriftGuideHatchChartEntry;
  /** Suggested sizes from the matched hatch, when available. */
  sizes?: string;
};

/**
 * Choose a single recommended fly to tie on right now from the month's prime hatches.
 * Picks the strongest hatch with a representative bundled fly; degrades to a generic
 * searcher with art so it never returns null. Used as a cheap local default before/while
 * the AI {@link getFlyOfTheDay} call resolves.
 */
export function chooseRecommendedFly(
  primeHatches: PrimeHatch[],
  hasImage: HasFlyImage = () => true,
): RecommendedFly {
  for (const { entry } of primeHatches) {
    const name = firstFlyWithImage(HATCH_ID_TO_FLY_CANDIDATES[entry.id] ?? [], hasImage);
    if (name) {
      return { name, forHatch: entry, sizes: entry.sizes };
    }
  }
  return { name: firstFlyWithImage(GENERIC_FLY_FALLBACKS, hasImage) ?? 'Adams' };
}

/**
 * One-line plain-language take for the hero. Combines nearby-water count + prime hatches into a
 * sentence that reads well with zero data (no GPS, no waters) or with full context.
 */
export function buildRightNowTake(opts: {
  rankedWatersCount: number;
  primeHatches: PrimeHatch[];
  recommendedFly: RecommendedFly;
  hasLocation: boolean;
}): string {
  const { rankedWatersCount, primeHatches, recommendedFly, hasLocation } = opts;
  const topHatch = primeHatches[0]?.entry.name;
  const flyClause = `start with a ${recommendedFly.name}`;

  if (rankedWatersCount > 0) {
    const where = rankedWatersCount === 1 ? 'the closest water' : `${rankedWatersCount} nearby waters`;
    return topHatch
      ? `${topHatch} should be worth planning around right now — ${flyClause} on ${where}.`
      : `I ranked ${where} for you — ${flyClause} and adjust to what you see.`;
  }
  if (topHatch) {
    return hasLocation
      ? `No catalog waters nearby yet, but ${topHatch} is prime this month — ${flyClause}.`
      : `${topHatch} is prime this month — ${flyClause}. Turn on location to rank waters near you.`;
  }
  return `${flyClause} and match the hatch you see on the water.`;
}
