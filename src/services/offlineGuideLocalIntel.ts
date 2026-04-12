import type { CommunityCatchRow, CatchRow } from '@/src/types';
import type { DownloadedWaterway } from '@/src/services/waterwayCache';
import { isPointInBoundingBox } from '@/src/types/boundingBox';
import { clockRangeForTimeOfDay } from '@/src/utils/offlineGuideBasics';

const LOOKBACK_DAYS = 60;
const TOP_FLIES = 3;

/** Mirrors bucket logic in `getTimeOfDay` (ai.ts) to avoid importing ai.ts from this module. */
export function timeOfDayBucket(date: Date): string {
  const hour = date.getHours();
  if (hour < 6) return 'pre-dawn';
  if (hour < 9) return 'early morning';
  if (hour < 12) return 'late morning';
  if (hour < 14) return 'midday';
  if (hour < 17) return 'afternoon';
  if (hour < 20) return 'evening';
  return 'night';
}

export function findMatchingDownloadedBundles(
  waterways: DownloadedWaterway[],
  opts: {
    locationIds: string[];
    lat: number | null;
    lng: number | null;
  },
): DownloadedWaterway[] {
  const { locationIds, lat, lng } = opts;
  const out: DownloadedWaterway[] = [];
  for (const w of waterways) {
    let match = false;
    for (const lid of locationIds) {
      if (lid && (w.locationId === lid || w.locationIds.includes(lid))) {
        match = true;
        break;
      }
    }
    if (
      !match &&
      lat != null &&
      lng != null &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      w.downloadBbox &&
      isPointInBoundingBox(lat, lng, w.downloadBbox)
    ) {
      match = true;
    }
    if (match) out.push(w);
  }
  return out;
}

function sinceIsoForLookback(refDate: Date): string {
  const d = new Date(refDate);
  d.setDate(d.getDate() - LOOKBACK_DAYS);
  return d.toISOString();
}

function flyLabelFromRow(
  pattern: string | null,
  size: number | null,
  color: string | null,
): string | null {
  if (!pattern?.trim()) return null;
  let s = pattern.trim();
  if (size != null && Number.isFinite(size)) s += ` #${size}`;
  if (color?.trim()) s += ` (${color.trim()})`;
  return s;
}

/** Exclude generic / non-informative catalog labels from offline “top flies” lists. */
export function isExcludedOfflineFlyPattern(pattern: string | null | undefined): boolean {
  const p = pattern?.trim().toLowerCase();
  if (!p) return true;
  if (p === 'other') return true;
  if (p.startsWith('other ')) return true;
  return false;
}

export function filterCommunityRowsForOfflineIntel(
  rows: CommunityCatchRow[],
  locationIds: string[],
  sinceIso: string,
): CommunityCatchRow[] {
  const idSet = new Set(locationIds.filter(Boolean));
  return rows.filter((r) => {
    const t = r.timestamp;
    if (!t || t < sinceIso) return false;
    if (idSet.size === 0) return true;
    return r.location_id != null && idSet.has(r.location_id);
  });
}

export function filterPersonalRowsForOfflineIntel(
  rows: CatchRow[],
  userId: string | null,
  locationIds: string[],
  sinceIso: string,
): CatchRow[] {
  if (!userId) return [];
  const idSet = new Set(locationIds.filter(Boolean));
  return rows.filter((r) => {
    if (r.user_id !== userId) return false;
    const t = r.timestamp;
    if (!t || t < sinceIso) return false;
    if (idSet.size === 0) return true;
    return r.location_id != null && idSet.has(r.location_id);
  });
}

function mergeCommunityCatches(bundles: DownloadedWaterway[]): CommunityCatchRow[] {
  const seen = new Set<string>();
  const out: CommunityCatchRow[] = [];
  for (const w of bundles) {
    for (const c of w.communityCatches ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

function mergePersonalCatches(bundles: DownloadedWaterway[]): CatchRow[] {
  const seen = new Set<string>();
  const out: CatchRow[] = [];
  for (const w of bundles) {
    for (const c of w.personalCatches ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

export type GuideOfflinePackFlyTip = {
  label: string;
  presentation: string | null;
};

export type GuideOfflinePackAggregates = {
  topFlies: GuideOfflinePackFlyTip[];
  /** Weighted catch-equivalent mass per `getTimeOfDay` bucket from saved logs. */
  bucketWeights: Record<string, number>;
  /** `fly_pattern` trimmed lower → weighted fish-equivalent (for rig vs. saved-log signal). */
  patternWeightByKey: Record<string, number>;
  /**
   * Dominant presentation across all filtered saves (community + yours) when sample is strong enough
   * to mention in “area typical” hints for flies with weak pattern match.
   */
  dominantPresentationOverall: string | null;
};

function presentationLabel(raw: string | null | undefined): string | null {
  const m = raw?.trim().toLowerCase();
  if (!m) return null;
  if (m.includes('nymph')) return 'nymph';
  if (m.includes('dry')) return 'dry fly';
  if (m.includes('streamer')) return 'streamer';
  if (m.includes('emerger')) return 'emerger';
  if (m.includes('wet')) return 'wet fly';
  return raw.trim();
}

function dominantPresentationOverallFromRows(
  rows: ReturnType<typeof unifiedFlyRows>,
): string | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (isExcludedOfflineFlyPattern(r.fly_pattern)) continue;
    const pl = presentationLabel(r.presentation_method);
    if (!pl) continue;
    const w = Math.max(1, Math.floor(Number(r.quantity) || 1));
    counts.set(pl, (counts.get(pl) ?? 0) + w);
    total += w;
  }
  if (total < 4) return null;
  let best: string | null = null;
  let max = 0;
  for (const [k, v] of counts) {
    if (v > max) {
      max = v;
      best = k;
    }
  }
  return max >= 2 ? best : null;
}

function dominantPresentationForLabel(
  rows: { fly_pattern: string | null; fly_size: number | null; fly_color: string | null; presentation_method: string | null; quantity: number }[],
  label: string,
): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const lbl = flyLabelFromRow(r.fly_pattern, r.fly_size, r.fly_color);
    if (lbl !== label) continue;
    const pl = presentationLabel(r.presentation_method);
    if (!pl) continue;
    const w = Math.max(1, Math.floor(Number(r.quantity) || 1));
    counts.set(pl, (counts.get(pl) ?? 0) + w);
  }
  let best: string | null = null;
  let max = 0;
  for (const [k, v] of counts) {
    if (v > max) {
      max = v;
      best = k;
    }
  }
  return max >= 1 ? best : null;
}

function buildBucketWeights(community: CommunityCatchRow[], personal: CatchRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  const bump = (iso: string, qty: number) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    const b = timeOfDayBucket(d);
    out[b] = (out[b] ?? 0) + Math.max(1, Math.floor(qty) || 1);
  };
  for (const r of community) bump(r.timestamp, Number(r.quantity) || 1);
  for (const r of personal) bump(r.timestamp, Number(r.quantity) || 1);
  return out;
}

function unifiedFlyRows(community: CommunityCatchRow[], personal: CatchRow[]) {
  type R = {
    fly_pattern: string | null;
    fly_size: number | null;
    fly_color: string | null;
    presentation_method: string | null;
    quantity: number;
  };
  const rows: R[] = [];
  for (const c of community) {
    rows.push({
      fly_pattern: c.fly_pattern,
      fly_size: c.fly_size,
      fly_color: c.fly_color,
      presentation_method: c.presentation_method,
      quantity: c.quantity,
    });
  }
  for (const c of personal) {
    rows.push({
      fly_pattern: c.fly_pattern,
      fly_size: c.fly_size,
      fly_color: c.fly_color,
      presentation_method: c.presentation_method,
      quantity: c.quantity,
    });
  }
  return rows;
}

function buildTopFliesFromRows(rows: ReturnType<typeof unifiedFlyRows>): GuideOfflinePackFlyTip[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (isExcludedOfflineFlyPattern(r.fly_pattern)) continue;
    const label = flyLabelFromRow(r.fly_pattern, r.fly_size, r.fly_color);
    if (!label) continue;
    const w = Math.max(1, Math.floor(Number(r.quantity) || 1));
    map.set(label, (map.get(label) ?? 0) + w);
  }
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_FLIES);
  return sorted.map(([label]) => ({
    label,
    presentation: dominantPresentationForLabel(rows, label),
  }));
}

function buildPatternWeightByKey(community: CommunityCatchRow[], personal: CatchRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of [...community, ...personal]) {
    if (isExcludedOfflineFlyPattern(r.fly_pattern)) continue;
    const fp = r.fly_pattern?.trim().toLowerCase();
    if (!fp) continue;
    const w = Math.max(1, Math.floor(Number(r.quantity) || 1));
    out[fp] = (out[fp] ?? 0) + w;
  }
  return out;
}

export type OfflinePackIntelParams = {
  locationIds: string[];
  userId: string | null;
  userLat: number | null;
  userLng: number | null;
  refDate: Date;
  refBucket: string;
};

export function buildOfflinePackAggregatesFromDownloads(
  waterways: DownloadedWaterway[],
  p: OfflinePackIntelParams,
): GuideOfflinePackAggregates | null {
  const bundles = findMatchingDownloadedBundles(waterways, {
    locationIds: p.locationIds,
    lat: p.userLat,
    lng: p.userLng,
  });
  if (bundles.length === 0) return null;

  const sinceIso = sinceIsoForLookback(p.refDate);
  const mergedComm = mergeCommunityCatches(bundles);
  const mergedPers = mergePersonalCatches(bundles);

  const community = filterCommunityRowsForOfflineIntel(mergedComm, p.locationIds, sinceIso);
  const personal = filterPersonalRowsForOfflineIntel(mergedPers, p.userId, p.locationIds, sinceIso);

  const rows = unifiedFlyRows(community, personal);
  const topFlies = buildTopFliesFromRows(rows);
  const bucketWeights = buildBucketWeights(community, personal);
  const patternWeightByKey = buildPatternWeightByKey(community, personal);
  const dominantPresentationOverall = dominantPresentationOverallFromRows(rows);

  if (topFlies.length === 0 && Object.keys(bucketWeights).length === 0 && Object.keys(patternWeightByKey).length === 0) {
    return null;
  }
  return { topFlies, bucketWeights, patternWeightByKey, dominantPresentationOverall };
}

/** Base pattern token from trip UI string, e.g. "Blue Wing Olive #18 (Olive)" → "blue wing olive". */
export function basePatternFromRigDisplay(rigLine: string | null | undefined): string | null {
  if (!rigLine?.trim()) return null;
  const cut = rigLine.split(/[#(]/)[0]?.trim().toLowerCase();
  return cut && cut.length > 0 ? cut : null;
}

export function patternStrengthFromWeightMap(
  baseLower: string,
  patternWeightByKey: Record<string, number>,
): 'none' | 'low' | 'good' | 'strong' {
  let w = 0;
  for (const [fp, val] of Object.entries(patternWeightByKey)) {
    if (fp === baseLower || fp.includes(baseLower) || baseLower.includes(fp)) w += val;
  }
  if (w <= 0) return 'none';
  if (w >= 12) return 'strong';
  if (w >= 4) return 'good';
  return 'low';
}

export function buildTopThreeUnifiedFliesParagraph(agg: GuideOfflinePackAggregates | null | undefined): string | null {
  if (!agg?.topFlies?.length) return null;
  const lines = agg.topFlies.map((f, i) => {
    const pres =
      f.presentation != null
        ? `Most often logged here as **${f.presentation}**.`
        : 'Presentation wasn’t recorded consistently in these logs — try a **dead-drift nymph** and a **visible dry** until you see what they want.';
    return `${i + 1}. **${f.label}** — ${pres}`;
  });
  return (
    'From **recent saved logs** (community and yours combined) for this area, patterns worth a look are:\n\n' +
    lines.join('\n\n')
  );
}

export type OfflineGuideWeatherHint = {
  condition: string;
  temperature_f?: number | null;
};

function humanizeTimeBucket(bucket: string): string {
  return bucket.replace(/-/g, ' ');
}

function presentationToAreaClause(label: string | null): string | null {
  if (!label) return null;
  const pl = label.toLowerCase();
  if (pl.includes('dry'))
    return '**Best fished on the surface** in these saves (dry presentations dominate)';
  if (pl.includes('nymph')) return '**Best fished subsurface** in these saves (nymph-style rigs dominate)';
  if (pl.includes('streamer')) return '**Best fished on moving flies** — streamer-style takes dominate the notes';
  if (pl.includes('emerger')) return '**Best fished in the film** — emergers show up most in presentation notes';
  if (pl.includes('wet')) return '**Best fished subsurface** — wet flies dominate logged presentations';
  return `Logged presentations center on **${label}**`;
}

/**
 * One or two sentences from area-wide saves (presentation + timing + cached weather)
 * when the angler’s exact rig pattern has weak / no match in `patternWeightByKey`.
 */
export function buildAreaIntelHintSentence(
  agg: GuideOfflinePackAggregates,
  weather: OfflineGuideWeatherHint | null | undefined,
): string | null {
  const parts: string[] = [];
  const pClause = presentationToAreaClause(agg.dominantPresentationOverall);
  if (pClause) parts.push(pClause);

  const entries = Object.entries(agg.bucketWeights).filter(([, v]) => v > 0);
  const bucketTotal = entries.reduce((s, [, v]) => s + v, 0);
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 2);

  if (bucketTotal >= 8 && top.length >= 2) {
    const a = `${humanizeTimeBucket(top[0][0])} (${clockRangeForTimeOfDay(top[0][0])})`;
    const b = `${humanizeTimeBucket(top[1][0])} (${clockRangeForTimeOfDay(top[1][0])})`;
    parts.push(`**Catch timing** in those logs clusters around **${a}** and **${b}**`);
  } else if (bucketTotal >= 4 && top.length >= 1) {
    const a = `${humanizeTimeBucket(top[0][0])} (${clockRangeForTimeOfDay(top[0][0])})`;
    parts.push(`**Catch timing** leans toward **${a}** in your offline bundle`);
  } else if (bucketTotal >= 2 && top.length >= 1) {
    const a = `${humanizeTimeBucket(top[0][0])} (${clockRangeForTimeOfDay(top[0][0])})`;
    parts.push(`Saved times hint toward **${a}** (small sample — use lightly)`);
  }

  if (weather?.condition?.trim()) {
    const cond = weather.condition.trim();
    const tf = weather.temperature_f;
    if (typeof tf === 'number' && Number.isFinite(tf)) {
      parts.push(`**Cached weather** here: **${cond}**, **${Math.round(tf)}°F**`);
    } else {
      parts.push(`**Cached weather**: **${cond}**`);
    }
  }

  if (parts.length === 0) return null;
  return `${parts.join('. ')}.`;
}

export function buildActivityPaceForOffline(refBucket: string, bucketWeights: Record<string, number>): string {
  const entries = Object.entries(bucketWeights).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total < 8) {
    return (
      '**Saved log timing** is thin for this download — treat **early** and **late** in the day as your default windows until you have more on-water history here.'
    );
  }
  let peakBucket = refBucket;
  let peak = 0;
  for (const [b, v] of entries) {
    if (v > peak) {
      peak = v;
      peakBucket = b;
    }
  }
  const current = bucketWeights[refBucket] ?? 0;
  const ratio = peak > 0 ? current / peak : 0;

  const nextHint = (exclude: string): string => {
    let bestB = '';
    let bestV = 0;
    for (const [b, v] of entries) {
      if (b === exclude) continue;
      if (v > bestV) {
        bestV = v;
        bestB = b;
      }
    }
    if (!bestB) return clockRangeForTimeOfDay(peakBucket);
    return `${bestB.replace(/-/g, ' ')} (${clockRangeForTimeOfDay(bestB)})`;
  };

  if (ratio >= 0.65) {
    const human = refBucket.replace(/-/g, ' ');
    const clock = clockRangeForTimeOfDay(refBucket);
    return `**Catch timing in saved logs** clusters most heavily in **${human} (${clock})** versus other parts of the day — you’re in that same window now, and this download shows **more logged fish there than in other time blocks**.`;
  }
  if (ratio <= 0.32) {
    const next = nextHint(refBucket);
    return `**Catch timing in saved logs** looks **softer right now** than other windows. If it stays quiet, the next bump in these entries is often toward **${next}**.`;
  }
  const next = nextHint(refBucket);
  return `**Catch timing in saved logs** looks **moderate** for now. If action is slow, try again toward **${next}** — that window shows more activity in your offline data.`;
}

export function buildRigAndSavedDataParagraph(
  primaryRig: string | null,
  dropperRig: string | null,
  agg: GuideOfflinePackAggregates | null | undefined,
  weather?: OfflineGuideWeatherHint | null,
): string | null {
  const patternWeightByKey = agg?.patternWeightByKey ?? {};
  const rigs: string[] = [];
  if (primaryRig?.trim()) rigs.push(primaryRig.trim());
  if (dropperRig?.trim()) rigs.push(dropperRig.trim());
  if (rigs.length === 0) {
    return 'You haven’t set flies on this trip in the app yet — choose patterns so offline tips can match what you’re actually fishing.';
  }

  const intro =
    rigs.length > 1
      ? `You’re fishing **${rigs[0]}** with **${rigs[1]}** on the rig.`
      : `You’re fishing **${rigs[0]}**.`;

  const parts: string[] = [intro];
  const hasWeights = Object.keys(patternWeightByKey).length > 0;
  for (const rig of rigs) {
    const shortName = rig.split(/[#(]/)[0]?.trim() ?? rig;
    const base = basePatternFromRigDisplay(rig);
    if (!base) continue;
    if (!hasWeights) {
      parts.push(
        `For **${shortName}**, there’s **no downloaded log bundle** tied to this spot yet — reconnect and refresh your offline region when you can to build signal.`,
      );
      continue;
    }
    const strength = patternStrengthFromWeightMap(base, patternWeightByKey);
    const areaHint = agg ? buildAreaIntelHintSentence(agg, weather ?? null) : null;
    if (strength === 'strong') {
      parts.push(`For **${shortName}**, saved logs for this area show **strong** recent signal — a solid bet to keep in the rotation.`);
    } else if (strength === 'good') {
      parts.push(`For **${shortName}**, saved logs show **decent** activity — worth keeping on unless fish clearly want something else.`);
    } else if (strength === 'low') {
      if (areaHint) {
        parts.push(
          `For **${shortName}**, **pattern-specific signal is light**, but your offline bundle still has useful defaults: ${areaHint} Use that as a starting line, then let risers and grabs tell you when to change.`,
        );
      } else {
        parts.push(
          `For **${shortName}**, there’s **only light** saved signal at this spot — experiment with depth and size before swapping the family entirely.`,
        );
      }
    } else {
      if (areaHint) {
        parts.push(
          `For **${shortName}**, **few saves name this exact fly**, but other catches in the same download point to a practical default: ${areaHint} Stack that against what you see before you swap.`,
        );
      } else {
        parts.push(
          `For **${shortName}**, there’s **little saved log signal** for this exact pattern in your offline data yet — use conditions and what you see on the water to decide.`,
        );
      }
    }
  }
  return parts.join('\n\n');
}
