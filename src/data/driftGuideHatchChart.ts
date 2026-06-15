/**
 * DriftGuide in-app hatch calendar: original summaries for cold, clear Western-style
 * freestone and tailwater fisheries. monthActivity is illustrative (0–3); local timing varies.
 */

export const MONTH_LABELS_SHORT = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] as const;

/** 0 = rare/off, 1 = possible, 2 = good, 3 = prime — index 0 = January */
export type MonthActivity = 0 | 1 | 2 | 3;

export type HatchCategory = 'midge' | 'mayfly' | 'caddis' | 'stone' | 'terrestrial' | 'stillwater';

/** Life stage a recommended pattern imitates; mirrors FlyPresentation grouping in pickers. */
export type HatchFlyStage = 'nymph' | 'emerger' | 'dry' | 'streamer';

export type HatchFly = {
  /**
   * Pattern name. MUST resolve via getBundledFlyImageSource (src/constants/flyImages.ts)
   * so the matching-flies strip always has a bundled image. Guarded by a vitest test.
   */
  name: string;
  stage: HatchFlyStage;
  /** Suggested hook size hint (free string, e.g. '#18–22'); derived from the entry's sizes. */
  size?: string;
};

/** Display order for life-stage labels in the matching-flies strip. */
export const HATCH_FLY_STAGE_ORDER: HatchFlyStage[] = ['nymph', 'emerger', 'dry', 'streamer'];

export const HATCH_FLY_STAGE_LABELS: Record<HatchFlyStage, string> = {
  nymph: 'Nymph',
  emerger: 'Emerger',
  dry: 'Dry',
  streamer: 'Streamer',
};

export type DaypartWeights = {
  dawn: number;
  morning: number;
  midday: number;
  afternoon: number;
  evening: number;
  night: number;
};

export type DriftGuideHatchChartEntry = {
  id: string;
  /** Short label for matrix rows */
  shortLabel: string;
  name: string;
  category: HatchCategory;
  monthActivity: readonly [
    MonthActivity,
    MonthActivity,
    MonthActivity,
    MonthActivity,
    MonthActivity,
    MonthActivity,
    MonthActivity,
    MonthActivity,
    MonthActivity,
    MonthActivity,
    MonthActivity,
    MonthActivity,
  ];
  /** Relative surface-feeding / activity tendency by time of day (any scale; normalized in UI) */
  daypart: DaypartWeights;
  sizes: string;
  water: string;
  tip: string;
  /** One-line for chips */
  peakSummary: string;
  /**
   * Curated patterns that imitate this hatch, grouped by life stage. Every name resolves to a
   * bundled image via getBundledFlyImageSource (verified by a vitest test). Offline-only.
   */
  flies: HatchFly[];
};

export const DRIFTGUIDE_HATCH_CHART_INTRO =
  "Cold, clear Western rivers and tailwaters. Bars show how often each bug is \"worth planning around\" by month (not a guarantee). Day strips show when surface-minded fish are more common.";

export const DRIFTGUIDE_HATCH_CHART_ENTRIES: DriftGuideHatchChartEntry[] = [
  {
    id: 'midge',
    shortLabel: 'Midge',
    name: 'Midges',
    category: 'midge',
    monthActivity: [3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 3, 3],
    daypart: { dawn: 8, morning: 22, midday: 28, afternoon: 22, evening: 12, night: 8 },
    sizes: '#18–24 zebra, thread, pupa',
    water: 'Slow runs, eddies, tailouts, dam outflows',
    tip: 'Dry cluster or griffiths over a zebra midge dropper covers most winter lies.',
    peakSummary: 'Year-round; winter–early spring peak',
    flies: [
      { name: 'Zebra Midge', stage: 'nymph', size: '#18–22' },
      { name: 'Black Beauty', stage: 'nymph', size: '#18–22' },
      { name: 'Brassie', stage: 'nymph', size: '#18–22' },
      { name: 'Top Secret Midge', stage: 'emerger', size: '#20–24' },
      { name: 'Griffiths Gnat', stage: 'dry', size: '#18–22' },
    ],
  },
  {
    id: 'bwo',
    shortLabel: 'BWO',
    name: 'Blue-Winged Olive (Baetis)',
    category: 'mayfly',
    monthActivity: [1, 2, 3, 3, 2, 1, 1, 1, 2, 3, 3, 2],
    daypart: { dawn: 5, morning: 15, midday: 25, afternoon: 35, evening: 15, night: 5 },
    sizes: '#18–22 dries & emergers',
    water: 'Seams, soft banks, slicks below riffles',
    tip: 'Treat spinners separately—quiet film, long leader.',
    peakSummary: 'Spring & fall double peak',
    flies: [
      { name: 'Pheasant Tail Nymph', stage: 'nymph', size: '#18–20' },
      { name: 'WD-40', stage: 'nymph', size: '#18–22' },
      { name: 'Juju Baetis', stage: 'nymph', size: '#18–22' },
      { name: 'RS2', stage: 'emerger', size: '#18–22' },
      { name: 'Sparkle Dun', stage: 'emerger', size: '#18–20' },
      { name: 'Parachute Adams', stage: 'dry', size: '#18–22' },
      { name: 'Comparadun', stage: 'dry', size: '#18–20' },
    ],
  },
  {
    id: 'march-brown',
    shortLabel: 'Mar/Gray',
    name: 'March Brown / Gray Drake',
    category: 'mayfly',
    monthActivity: [0, 0, 1, 3, 3, 2, 1, 0, 0, 0, 0, 0],
    daypart: { dawn: 5, morning: 20, midday: 45, afternoon: 25, evening: 5, night: 0 },
    sizes: '#12–14',
    water: 'Riffle tails, pockets, willow lines',
    tip: 'Soft-hackle or emerger swing when they ignore high dries.',
    peakSummary: 'Apr–Jun by elevation',
    flies: [
      { name: 'Hares Ear Nymph', stage: 'nymph', size: '#12–14' },
      { name: 'Pheasant Tail Nymph', stage: 'nymph', size: '#12–14' },
      { name: 'Soft Hackle', stage: 'emerger', size: '#12–14' },
      { name: 'March Brown Wet', stage: 'emerger', size: '#12–14' },
      { name: 'March Brown', stage: 'dry', size: '#12–14' },
      { name: 'Gray Drake', stage: 'dry', size: '#12–14' },
    ],
  },
  {
    id: 'skwala',
    shortLabel: 'Skwala',
    name: 'Skwala stonefly',
    category: 'stone',
    monthActivity: [0, 1, 3, 3, 2, 0, 0, 0, 0, 0, 0, 0],
    daypart: { dawn: 0, morning: 25, midday: 55, afternoon: 20, evening: 0, night: 0 },
    sizes: '#8–12',
    water: 'Boulders, grassy banks, inside bends',
    tip: 'Short drifts tight to banks beat long mid-river casts.',
    peakSummary: 'Mar–May low elevation first',
    flies: [
      { name: "Pat's Rubber Legs", stage: 'nymph', size: '#8–12' },
      { name: 'Girdle Bug', stage: 'nymph', size: '#8–12' },
      { name: 'Chubby Chernobyl', stage: 'dry', size: '#8–12' },
      { name: 'Stimulator', stage: 'dry', size: '#10–12' },
    ],
  },
  {
    id: 'salmonfly',
    shortLabel: 'Salmon',
    name: 'Salmonfly / large stones',
    category: 'stone',
    monthActivity: [0, 0, 0, 1, 3, 3, 2, 1, 0, 0, 0, 0],
    daypart: { dawn: 0, morning: 20, midday: 40, afternoon: 35, evening: 5, night: 0 },
    sizes: '#4–8',
    water: 'Fast pockets, willows, root wads',
    tip: 'If they refuse foam, try one size smaller or a drowned adult.',
    peakSummary: 'May–Jul upstream wave',
    flies: [
      { name: "Pat's Rubber Legs", stage: 'nymph', size: '#4–8' },
      { name: 'Girdle Bug', stage: 'nymph', size: '#4–8' },
      { name: 'Kamikaze Salmonfly', stage: 'dry', size: '#4–8' },
      { name: 'Chubby Chernobyl', stage: 'dry', size: '#4–8' },
      { name: 'Stimulator', stage: 'dry', size: '#6–8' },
    ],
  },
  {
    id: 'golden',
    shortLabel: 'Sally',
    name: 'Golden stone / Sally',
    category: 'stone',
    monthActivity: [0, 0, 0, 0, 1, 3, 3, 3, 1, 0, 0, 0],
    daypart: { dawn: 0, morning: 10, midday: 30, afternoon: 35, evening: 25, night: 0 },
    sizes: '#10–16',
    water: 'Riffles, pockets, rocky drops',
    tip: 'Trim legs so the fly rides upright in broken water.',
    peakSummary: 'Jun–Aug after big stones',
    flies: [
      { name: 'Golden Stone Nymph', stage: 'nymph', size: '#10–14' },
      { name: "Pat's Rubber Legs", stage: 'nymph', size: '#10–14' },
      { name: 'Yellow Sally', stage: 'dry', size: '#12–16' },
      { name: 'Stimulator', stage: 'dry', size: '#10–14' },
      { name: 'Chubby Chernobyl', stage: 'dry', size: '#10–14' },
    ],
  },
  {
    id: 'pmd',
    shortLabel: 'PMD',
    name: 'Pale Morning Dun',
    category: 'mayfly',
    monthActivity: [0, 0, 0, 0, 1, 3, 3, 3, 2, 1, 0, 0],
    daypart: { dawn: 0, morning: 25, midday: 40, afternoon: 30, evening: 5, night: 0 },
    sizes: '#16–18',
    water: 'Slicks, back eddies, riffle exits',
    tip: 'Match dun vs spinner vs emerger; 6x on flat slicks.',
    peakSummary: 'Jun–Sep',
    flies: [
      { name: 'Pheasant Tail Nymph', stage: 'nymph', size: '#16–18' },
      { name: 'Frenchie', stage: 'nymph', size: '#16–18' },
      { name: 'Sparkle Dun', stage: 'emerger', size: '#16–18' },
      { name: 'CDC Emerger', stage: 'emerger', size: '#16–18' },
      { name: 'Pale Morning Dun', stage: 'dry', size: '#16–18' },
      { name: 'Comparadun', stage: 'dry', size: '#16–18' },
    ],
  },
  {
    id: 'green-drake',
    shortLabel: 'G.Drake',
    name: 'Green Drake / Flav',
    category: 'mayfly',
    monthActivity: [0, 0, 0, 0, 0, 1, 3, 3, 1, 0, 0, 0],
    daypart: { dawn: 0, morning: 5, midday: 15, afternoon: 25, evening: 45, night: 10 },
    sizes: '#10–14',
    water: 'Deep pools, tailouts below fast water',
    tip: 'Be ready to switch nymph to dry when the hatch tightens fish.',
    peakSummary: 'Jul–Aug select waters',
    flies: [
      { name: 'Pheasant Tail Nymph', stage: 'nymph', size: '#10–14' },
      { name: 'Hares Ear Nymph', stage: 'nymph', size: '#10–14' },
      { name: 'Green Drake', stage: 'dry', size: '#10–14' },
      { name: 'Klinkhammer', stage: 'emerger', size: '#10–14' },
    ],
  },
  {
    id: 'trico',
    shortLabel: 'Trico',
    name: 'Tricos',
    category: 'mayfly',
    monthActivity: [0, 0, 0, 0, 0, 1, 3, 3, 3, 1, 0, 0],
    daypart: { dawn: 55, morning: 35, midday: 5, afternoon: 5, evening: 0, night: 0 },
    sizes: '#20–24',
    water: 'Flat slicks, backwaters, fertile runs',
    tip: 'Spinner falls before sun hits the film.',
    peakSummary: 'Jul–Sep',
    flies: [
      { name: 'WD-40', stage: 'nymph', size: '#20–24' },
      { name: 'Trico', stage: 'dry', size: '#20–24' },
      { name: 'Griffiths Gnat', stage: 'dry', size: '#20–24' },
    ],
  },
  {
    id: 'caddis',
    shortLabel: 'Caddis',
    name: 'Caddis (tan, olive, black)',
    category: 'caddis',
    monthActivity: [0, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 0],
    daypart: { dawn: 0, morning: 10, midday: 25, afternoon: 25, evening: 35, night: 5 },
    sizes: '#14–18',
    water: 'Bank foam, riffle crests, brush',
    tip: 'Skate or skitter first; dead-drift emerger if refused.',
    peakSummary: 'Apr–Oct; evenings midsummer',
    flies: [
      { name: 'Sparkle Pupa', stage: 'nymph', size: '#14–18' },
      { name: 'Soft Hackle', stage: 'emerger', size: '#14–18' },
      { name: 'X-Caddis', stage: 'emerger', size: '#14–18' },
      { name: 'Elk Hair Caddis', stage: 'dry', size: '#14–18' },
      { name: 'Goddard Caddis', stage: 'dry', size: '#14–18' },
    ],
  },
  {
    id: 'oct-caddis',
    shortLabel: 'Oct cad',
    name: 'October caddis',
    category: 'caddis',
    monthActivity: [0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 1],
    daypart: { dawn: 0, morning: 5, midday: 15, afternoon: 35, evening: 40, night: 5 },
    sizes: '#6–10',
    water: 'Undercut banks, pockets, tailouts',
    tip: 'One big fly tight to the bank beats fan-casting mid-river.',
    peakSummary: 'Sep–Nov',
    flies: [
      { name: 'Sparkle Pupa', stage: 'nymph', size: '#8–10' },
      { name: 'Prince Nymph', stage: 'nymph', size: '#8–12' },
      { name: 'Orange Stimulator', stage: 'dry', size: '#6–10' },
      { name: 'Stimulator', stage: 'dry', size: '#6–10' },
    ],
  },
  {
    id: 'callibaetis',
    shortLabel: 'Calli',
    name: 'Callibaetis (lakes)',
    category: 'stillwater',
    monthActivity: [0, 0, 0, 1, 3, 3, 3, 3, 2, 0, 0, 0],
    daypart: { dawn: 10, morning: 20, midday: 35, afternoon: 20, evening: 15, night: 0 },
    sizes: '#14–18',
    water: 'Weed edges, drop-offs, inlets',
    tip: 'Deep nymphs until risers appear, then film emergers.',
    peakSummary: 'May–Sep stillwaters',
    flies: [
      { name: 'Pheasant Tail Nymph', stage: 'nymph', size: '#14–18' },
      { name: 'Hares Ear Nymph', stage: 'nymph', size: '#14–18' },
      { name: 'Sparkle Dun', stage: 'emerger', size: '#14–18' },
      { name: 'Parachute Adams', stage: 'dry', size: '#14–18' },
      { name: 'Woolly Bugger', stage: 'streamer', size: '#8–12' },
    ],
  },
  {
    id: 'terrestrial',
    shortLabel: 'Terrest',
    name: 'Terrestrials',
    category: 'terrestrial',
    monthActivity: [0, 0, 0, 0, 0, 1, 3, 3, 3, 1, 0, 0],
    daypart: { dawn: 0, morning: 10, midday: 45, afternoon: 40, evening: 5, night: 0 },
    sizes: '#8–16',
    water: 'Grass lines, willows, fence rows',
    tip: 'Land tight to the bank; one plop then drift.',
    peakSummary: 'Jul–Sep',
    flies: [
      { name: "Dave's Hopper", stage: 'dry', size: '#8–12' },
      { name: 'Morrish Hopper', stage: 'dry', size: '#8–12' },
      { name: 'Chernobyl Ant', stage: 'dry', size: '#8–12' },
      { name: 'Hippie Stomper', stage: 'dry', size: '#10–14' },
      { name: 'Beetle', stage: 'dry', size: '#12–16' },
      { name: 'Ant', stage: 'dry', size: '#14–16' },
    ],
  },
  {
    id: 'mahogany',
    shortLabel: 'Mahog',
    name: 'Mahogany / small fall mayflies',
    category: 'mayfly',
    monthActivity: [0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 3, 1],
    daypart: { dawn: 0, morning: 15, midday: 40, afternoon: 35, evening: 10, night: 0 },
    sizes: '#16–18',
    water: 'Soft edges, foam in low flows',
    tip: 'Low clear water: fewer false casts before changing fly.',
    peakSummary: 'Sep–Nov',
    flies: [
      { name: 'Pheasant Tail Nymph', stage: 'nymph', size: '#16–18' },
      { name: 'Frenchie', stage: 'nymph', size: '#16–18' },
      { name: 'RS2', stage: 'emerger', size: '#16–18' },
      { name: 'Red Quill', stage: 'dry', size: '#16–18' },
      { name: 'Parachute Adams', stage: 'dry', size: '#16–18' },
    ],
  },
];

const CATEGORY_ORDER: HatchCategory[] = ['midge', 'mayfly', 'caddis', 'stone', 'terrestrial', 'stillwater'];

export function hatchEntriesSortedByCategory(entries: DriftGuideHatchChartEntry[]): DriftGuideHatchChartEntry[] {
  return [...entries].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name),
  );
}

/** 0-based month (Date.getMonth()) */
export function hatchActivityForMonth(entry: DriftGuideHatchChartEntry, monthIndex0: number): MonthActivity {
  const m = Math.max(0, Math.min(11, monthIndex0));
  return entry.monthActivity[m] ?? 0;
}

/** Group an entry's matching flies by life stage, in HATCH_FLY_STAGE_ORDER (empty stages dropped). */
export function hatchFliesByStage(
  entry: DriftGuideHatchChartEntry,
): { stage: HatchFlyStage; label: string; flies: HatchFly[] }[] {
  return HATCH_FLY_STAGE_ORDER.map((stage) => ({
    stage,
    label: HATCH_FLY_STAGE_LABELS[stage],
    flies: entry.flies.filter((f) => f.stage === stage),
  })).filter((g) => g.flies.length > 0);
}

export function entriesStrongThisMonth(
  entries: DriftGuideHatchChartEntry[],
  monthIndex0: number,
  minLevel: MonthActivity = 2,
): DriftGuideHatchChartEntry[] {
  return entries.filter((e) => hatchActivityForMonth(e, monthIndex0) >= minLevel);
}
