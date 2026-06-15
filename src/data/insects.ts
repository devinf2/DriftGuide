/**
 * Bug Matcher insect dataset (WS-F).
 *
 * A small, curated list of common Western fly-fishing insects keyed for two
 * identification paths:
 *   1. Offline feature key — narrow by visible traits (category → size → body
 *      color → wing/profile → life stage) down to one candidate insect.
 *   2. AI photo ID — the edge function returns an insect/category/lifeStage and a
 *      list of fly names; those names resolve through `getBundledFlyImageSource`.
 *
 * Every fly NAME in `fliesByLifeStage` is verified to resolve via
 * `getBundledFlyImageSource` (see src/data/insects.test.ts). Insect imagery is
 * intentionally omitted — there is no bundled insect art yet; the UI works
 * without it. See ASSET TODO below.
 *
 * TODO(assets): add bundled insect reference photos/illustrations and reference
 * them here via an optional `image` field once art exists.
 * TODO(WS-E reconcile): WS-E is adding a curated hatch→fly mapping to
 * driftGuideHatchChart. The `fliesByLifeStage` lists here are a small standalone
 * duplicate to avoid edit conflicts; reconcile the two sources in a follow-up.
 */

import type { HatchCategory } from '@/src/data/driftGuideHatchChart';
import { resolveInsectToChartId } from '@/src/utils/hatchModalEnrichment';

/** Aquatic + terrestrial life stages an angler might see on/in the water. */
export type InsectLifeStage =
  | 'nymph'
  | 'larva'
  | 'pupa'
  | 'emerger'
  | 'dun'
  | 'adult'
  | 'spinner';

export const LIFE_STAGE_LABELS: Record<InsectLifeStage, string> = {
  nymph: 'Nymph',
  larva: 'Larva',
  pupa: 'Pupa',
  emerger: 'Emerger',
  dun: 'Dun (winged)',
  adult: 'Adult',
  spinner: 'Spinner (spent)',
};

/** Coarse body-color buckets used by the offline feature key. */
export type InsectBodyColor =
  | 'olive'
  | 'gray'
  | 'tan'
  | 'brown'
  | 'black'
  | 'cream'
  | 'yellow'
  | 'orange'
  | 'rust';

export const BODY_COLOR_LABELS: Record<InsectBodyColor, string> = {
  olive: 'Olive',
  gray: 'Gray',
  tan: 'Tan',
  brown: 'Brown',
  black: 'Black',
  cream: 'Cream',
  yellow: 'Yellow',
  orange: 'Orange',
  rust: 'Rust / red',
};

/** Visible wing / silhouette traits an angler can judge at the vise or streamside. */
export type InsectProfile =
  | 'upright-wing' // mayfly dun: sail-like upright wings
  | 'spent-wing' // mayfly spinner: wings flat/out to the sides
  | 'tent-wing' // caddis: wings folded tent-like over the body
  | 'flat-wing' // stonefly: long wings flat over a stout body
  | 'cluster' // midge clusters / tiny two-wing
  | 'no-wing' // nymphs/larvae/pupae underwater (no wings yet)
  | 'terrestrial'; // land bug silhouette (legs/hard body/hopper)

export const PROFILE_LABELS: Record<InsectProfile, string> = {
  'upright-wing': 'Upright sail wings (mayfly dun)',
  'spent-wing': 'Spent / flat-out wings (spinner)',
  'tent-wing': 'Tent-shaped wings (caddis)',
  'flat-wing': 'Long flat wings (stonefly)',
  cluster: 'Tiny clusters / two wings (midge)',
  'no-wing': 'No wings — underwater stage',
  terrestrial: 'Land bug (ant / beetle / hopper)',
};

/** Hook-size bucket; insects carry the numeric span so the size filter is range-based. */
export type SizeBucket = 'tiny' | 'small' | 'medium' | 'large';

export const SIZE_BUCKETS: { key: SizeBucket; label: string; minHook: number; maxHook: number }[] = [
  // Hook numbers are inverse to bug size: bigger number = smaller bug.
  { key: 'tiny', label: 'Tiny (#20–24)', minHook: 20, maxHook: 24 },
  { key: 'small', label: 'Small (#16–20)', minHook: 16, maxHook: 20 },
  { key: 'medium', label: 'Medium (#12–16)', minHook: 12, maxHook: 16 },
  { key: 'large', label: 'Large (#4–12)', minHook: 4, maxHook: 12 },
];

export type Insect = {
  id: string;
  /** Common angler name, e.g. "Blue-Winged Olive (BWO)". */
  commonName: string;
  /** Matches DriftGuideHatchChart categories so we can cross-link the hatch calendar. */
  category: HatchCategory;
  /** Inclusive hook-size span (smaller number = bigger bug). */
  sizeRange: { minHook: number; maxHook: number };
  bodyColors: InsectBodyColor[];
  profiles: InsectProfile[];
  lifeStages: InsectLifeStage[];
  /** Months (1–12) when this bug is worth planning around. */
  activeMonths: number[];
  /** One-line streamside ID note. */
  idNote: string;
  /** Hatch-calendar entry id (via resolveInsectToChartId, or explicit override). */
  hatchChartId: string | null;
  /** Curated matching fly NAMES per life stage. Every name resolves via getBundledFlyImageSource. */
  fliesByLifeStage: Partial<Record<InsectLifeStage, string[]>>;
};

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Resolve the hatch id from the common name, allowing an explicit override. */
function hatchId(commonName: string, override?: string): string | null {
  return override ?? resolveInsectToChartId(commonName);
}

export const INSECTS: Insect[] = [
  // ---- Mayflies ----
  {
    id: 'bwo',
    commonName: 'Blue-Winged Olive (BWO)',
    category: 'mayfly',
    sizeRange: { minHook: 16, maxHook: 22 },
    bodyColors: ['olive', 'gray'],
    profiles: ['upright-wing', 'spent-wing', 'no-wing'],
    lifeStages: ['nymph', 'emerger', 'dun', 'spinner'],
    activeMonths: [3, 4, 5, 9, 10, 11],
    idNote: 'Small slate-olive mayfly; loves cloudy, drizzly days spring and fall.',
    hatchChartId: hatchId('blue winged olive', 'bwo'),
    fliesByLifeStage: {
      nymph: ['Pheasant Tail Nymph', 'Juju Baetis', "Craven's Juju Baetis"],
      emerger: ['RS2', 'WD-40', "Barr's Emerger"],
      dun: ['Blue Wing Olive', 'Parachute Adams', 'Sparkle Dun'],
      spinner: ['Cripple BWO', 'CDC Emerger'],
    },
  },
  {
    id: 'pmd',
    commonName: 'Pale Morning Dun (PMD)',
    category: 'mayfly',
    sizeRange: { minHook: 14, maxHook: 18 },
    bodyColors: ['yellow', 'cream', 'olive'],
    profiles: ['upright-wing', 'spent-wing', 'no-wing'],
    lifeStages: ['nymph', 'emerger', 'dun', 'spinner'],
    activeMonths: [6, 7, 8],
    idNote: 'Pale yellow-cream mayfly; mid-morning summer emergence in tailwaters.',
    hatchChartId: hatchId('pale morning dun', 'pmd'),
    fliesByLifeStage: {
      nymph: ['Pheasant Tail Nymph', 'Flashback Pheasant Tail'],
      emerger: ['Sparkle Dun', "Barr's Emerger", 'CDC Emerger'],
      dun: ['Pale Morning Dun', 'Comparadun', 'No Hackle Dry'],
      spinner: ['Light Cahill', 'Comparadun'],
    },
  },
  {
    id: 'trico',
    commonName: 'Trico',
    category: 'mayfly',
    sizeRange: { minHook: 20, maxHook: 24 },
    bodyColors: ['black', 'olive'],
    profiles: ['upright-wing', 'spent-wing', 'cluster'],
    lifeStages: ['nymph', 'dun', 'spinner'],
    activeMonths: [7, 8, 9, 10],
    idNote: 'Tiny black-bodied mayfly; clouds of spent spinners late summer mornings.',
    hatchChartId: hatchId('trico'),
    fliesByLifeStage: {
      nymph: ['Pheasant Tail Nymph'],
      dun: ['Trico', 'Griffiths Gnat'],
      spinner: ['Trico', 'Sparkle Dun'],
    },
  },
  {
    id: 'march-brown',
    commonName: 'March Brown',
    category: 'mayfly',
    sizeRange: { minHook: 12, maxHook: 14 },
    bodyColors: ['brown', 'tan'],
    profiles: ['upright-wing', 'no-wing'],
    lifeStages: ['nymph', 'emerger', 'dun', 'spinner'],
    activeMonths: [4, 5, 6],
    idNote: 'Mottled brown mayfly; sporadic spring riffle hatch, often midday.',
    hatchChartId: hatchId('march brown'),
    fliesByLifeStage: {
      nymph: ['Hares Ear Nymph', 'Gold Ribbed Hare\'s Ear'],
      emerger: ['March Brown Wet', 'Soft Hackle'],
      dun: ['March Brown', 'Adams', 'Red Quill'],
      spinner: ['Red Quill', 'Adams'],
    },
  },
  {
    id: 'green-drake',
    commonName: 'Green Drake',
    category: 'mayfly',
    sizeRange: { minHook: 8, maxHook: 12 },
    bodyColors: ['olive', 'gray'],
    profiles: ['upright-wing', 'no-wing'],
    lifeStages: ['nymph', 'emerger', 'dun', 'spinner'],
    activeMonths: [6, 7],
    idNote: 'Big olive mayfly; brings up large trout on early-summer freestones.',
    hatchChartId: hatchId('green drake'),
    fliesByLifeStage: {
      nymph: ['Hares Ear Nymph'],
      emerger: ['Green Drake', 'Sparkle Dun'],
      dun: ['Green Drake', 'Parachute Adams'],
      spinner: ['Green Drake'],
    },
  },
  {
    id: 'callibaetis',
    commonName: 'Callibaetis',
    category: 'mayfly',
    sizeRange: { minHook: 14, maxHook: 18 },
    bodyColors: ['gray', 'tan'],
    profiles: ['upright-wing', 'spent-wing', 'no-wing'],
    lifeStages: ['nymph', 'emerger', 'dun', 'spinner'],
    activeMonths: [5, 6, 7, 8, 9],
    idNote: 'Speckled-wing stillwater mayfly; cruise the flats on calm lake mornings.',
    hatchChartId: hatchId('callibaetis'),
    fliesByLifeStage: {
      nymph: ['Pheasant Tail Nymph', 'Zug Bug'],
      emerger: ['Sparkle Dun', 'CDC Emerger'],
      dun: ['Parachute Adams', 'Comparadun'],
      spinner: ['Adams'],
    },
  },
  {
    id: 'mahogany',
    commonName: 'Mahogany Dun',
    category: 'mayfly',
    sizeRange: { minHook: 14, maxHook: 18 },
    bodyColors: ['brown', 'rust'],
    profiles: ['upright-wing', 'spent-wing', 'no-wing'],
    lifeStages: ['nymph', 'emerger', 'dun', 'spinner'],
    activeMonths: [9, 10],
    idNote: 'Reddish-brown fall mayfly; overlaps the autumn BWO window.',
    hatchChartId: hatchId('mahogany'),
    fliesByLifeStage: {
      nymph: ['Pheasant Tail Nymph'],
      emerger: ['RS2', 'CDC Emerger'],
      dun: ['Red Quill', 'Parachute Adams', 'Blue Quill'],
      spinner: ['Red Quill'],
    },
  },
  // ---- Caddis ----
  {
    id: 'caddis',
    commonName: 'Caddis (generic)',
    category: 'caddis',
    sizeRange: { minHook: 12, maxHook: 18 },
    bodyColors: ['tan', 'olive', 'brown'],
    profiles: ['tent-wing', 'no-wing'],
    lifeStages: ['larva', 'pupa', 'adult'],
    activeMonths: [5, 6, 7, 8, 9],
    idNote: 'Moth-like tent wings; evening egg-laying flights skitter the surface.',
    hatchChartId: hatchId('caddis'),
    fliesByLifeStage: {
      larva: ['Hares Ear Nymph', 'Mop Fly'],
      pupa: ['Sparkle Pupa', 'Soft Hackle'],
      adult: ['Elk Hair Caddis', 'X-Caddis', 'Goddard Caddis', 'Henryville Special'],
    },
  },
  {
    id: 'oct-caddis',
    commonName: 'October Caddis',
    category: 'caddis',
    sizeRange: { minHook: 8, maxHook: 12 },
    bodyColors: ['orange', 'rust'],
    profiles: ['tent-wing', 'no-wing'],
    lifeStages: ['pupa', 'adult'],
    activeMonths: [9, 10, 11],
    idNote: 'Large pumpkin-orange caddis; the last big bug of fall.',
    hatchChartId: hatchId('october caddis', 'oct-caddis'),
    fliesByLifeStage: {
      pupa: ['Sparkle Pupa', 'Soft Hackle'],
      adult: ['Orange Stimulator', 'Stimulator', 'Elk Hair Caddis'],
    },
  },
  // ---- Stoneflies ----
  {
    id: 'salmonfly',
    commonName: 'Salmonfly',
    category: 'stone',
    sizeRange: { minHook: 4, maxHook: 8 },
    bodyColors: ['orange', 'black'],
    profiles: ['flat-wing', 'no-wing'],
    lifeStages: ['nymph', 'adult'],
    activeMonths: [5, 6, 7],
    idNote: 'Giant orange-and-black stonefly; trophy dry-fly window on big rivers.',
    hatchChartId: hatchId('salmonfly'),
    fliesByLifeStage: {
      nymph: ["Pat's Rubber Legs", 'Girdle Bug', '20 Incher'],
      adult: ['Chubby Chernobyl', 'Kamikaze Salmonfly', 'Stimulator'],
    },
  },
  {
    id: 'golden-stone',
    commonName: 'Golden Stone',
    category: 'stone',
    sizeRange: { minHook: 6, maxHook: 12 },
    bodyColors: ['yellow', 'tan', 'brown'],
    profiles: ['flat-wing', 'no-wing'],
    lifeStages: ['nymph', 'adult'],
    activeMonths: [6, 7, 8],
    idNote: 'Golden-tan stonefly; follows the salmonflies through early summer.',
    hatchChartId: hatchId('golden stone', 'golden'),
    fliesByLifeStage: {
      nymph: ['Golden Stone Nymph', "Pat's Rubber Legs", '20 Incher'],
      adult: ['Stimulator', 'Chubby Chernobyl', 'Orange Stimulator'],
    },
  },
  {
    id: 'skwala',
    commonName: 'Skwala',
    category: 'stone',
    sizeRange: { minHook: 8, maxHook: 12 },
    bodyColors: ['olive', 'brown'],
    profiles: ['flat-wing', 'no-wing'],
    lifeStages: ['nymph', 'adult'],
    activeMonths: [3, 4],
    idNote: 'Olive early-spring stonefly; pre-runoff dry action on western rivers.',
    hatchChartId: hatchId('skwala'),
    fliesByLifeStage: {
      nymph: ["Pat's Rubber Legs", 'Girdle Bug'],
      adult: ['Stimulator', 'Chubby Chernobyl'],
    },
  },
  {
    id: 'yellow-sally',
    commonName: 'Yellow Sally',
    category: 'stone',
    sizeRange: { minHook: 12, maxHook: 16 },
    bodyColors: ['yellow'],
    profiles: ['flat-wing', 'no-wing'],
    lifeStages: ['nymph', 'adult'],
    activeMonths: [6, 7, 8],
    idNote: 'Small bright-yellow stonefly; common summer afternoon along riffles.',
    hatchChartId: hatchId('yellow sally', 'golden'),
    fliesByLifeStage: {
      nymph: ['Golden Stone Nymph', "Pheasant Tail Nymph"],
      adult: ['Yellow Sally', 'Stimulator', 'Humpy'],
    },
  },
  // ---- Midges ----
  {
    id: 'midge',
    commonName: 'Midge',
    category: 'midge',
    sizeRange: { minHook: 18, maxHook: 24 },
    bodyColors: ['black', 'gray', 'olive', 'cream'],
    profiles: ['cluster', 'no-wing'],
    lifeStages: ['larva', 'pupa', 'adult'],
    activeMonths: ALL_MONTHS,
    idNote: 'Tiny two-winged fly; the staple food source on cold tailwaters year-round.',
    hatchChartId: hatchId('midge'),
    fliesByLifeStage: {
      larva: ['Zebra Midge', 'Brassie', 'Black Beauty'],
      pupa: ['Zebra Midge', 'Top Secret Midge', 'Poison Tung'],
      adult: ['Griffiths Gnat', 'Renegade'],
    },
  },
  // ---- Terrestrials ----
  {
    id: 'ant',
    commonName: 'Ant',
    category: 'terrestrial',
    sizeRange: { minHook: 14, maxHook: 20 },
    bodyColors: ['black', 'rust', 'brown'],
    profiles: ['terrestrial'],
    lifeStages: ['adult'],
    activeMonths: [6, 7, 8, 9],
    idNote: 'Pinched-waist land bug; flying ant falls can be lights-out in late summer.',
    hatchChartId: hatchId('ant', 'terrestrial'),
    fliesByLifeStage: {
      adult: ['Ant', 'Parachute Ant', 'Flying Ant'],
    },
  },
  {
    id: 'beetle',
    commonName: 'Beetle',
    category: 'terrestrial',
    sizeRange: { minHook: 12, maxHook: 18 },
    bodyColors: ['black', 'brown'],
    profiles: ['terrestrial'],
    lifeStages: ['adult'],
    activeMonths: [6, 7, 8, 9],
    idNote: 'Hard-shelled land bug; a reliable summer searching pattern near banks.',
    hatchChartId: hatchId('beetle', 'terrestrial'),
    fliesByLifeStage: {
      adult: ['Beetle', 'Hippie Stomper', 'Chernobyl Ant'],
    },
  },
  {
    id: 'hopper',
    commonName: 'Grasshopper',
    category: 'terrestrial',
    sizeRange: { minHook: 6, maxHook: 12 },
    bodyColors: ['tan', 'yellow', 'olive'],
    profiles: ['terrestrial'],
    lifeStages: ['adult'],
    activeMonths: [7, 8, 9],
    idNote: 'Big land bug; hot, windy late-summer days blow them onto the water.',
    hatchChartId: hatchId('hopper', 'terrestrial'),
    fliesByLifeStage: {
      adult: ["Dave's Hopper", 'Morrish Hopper', 'Parachute Hopper', 'Chubby Chernobyl'],
    },
  },
];

/** Flatten the per-stage fly lists for a given insect, deduped, in stage order. */
export function fliesForInsect(insect: Insect, stage?: InsectLifeStage | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const stages: InsectLifeStage[] = stage ? [stage] : (Object.keys(insect.fliesByLifeStage) as InsectLifeStage[]);
  for (const s of stages) {
    for (const name of insect.fliesByLifeStage[s] ?? []) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/** Every distinct fly name referenced across the dataset (for tests / preloading). */
export function allReferencedFlyNames(): string[] {
  const seen = new Set<string>();
  for (const insect of INSECTS) {
    for (const list of Object.values(insect.fliesByLifeStage)) {
      for (const name of list ?? []) seen.add(name);
    }
  }
  return [...seen];
}
