import type { Location } from '@/src/types';
import type { AIContext } from '@/src/services/ai';
import { getTimeOfDay } from '@/src/services/ai';
import { fetchTopCatalogLocationIdsByRecentCatches } from '@/src/services/catchAggregates';
import { invokeGuideIntel, isOnlineForGuideIntel, parseExtractLocationsResponse } from '@/src/services/guideIntelClient';
import { getDownloadedWaterways } from '@/src/services/waterwayCache';
import { buildOfflinePackAggregatesFromDownloads } from '@/src/services/offlineGuideLocalIntel';
import { supabase } from '@/src/services/supabase';
import { questionWantsLocationRecommendation } from '@/src/utils/guideChatIntent';
import {
  extractPlaceHintsFromQuestion,
  findMentionedLocations,
  distanceKmToLocation,
  nearestCatalogLocations,
} from '@/src/utils/mentionedLocations';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';
import { internalRawFromCounts } from '@/src/services/driftGuideScore';
import { internalCatchScalingNote } from '@/src/utils/internalCatchScaling';
import { resolveRegionLabelAsync } from '@/src/utils/regionFromCoords';
import {
  resolveExtractedMentionsToCatalog,
  type MentionResolution,
} from '@/src/utils/resolveLocationMentions';

const CATCH_LOOKBACK_DAYS = 60;
const MAX_ROWS_PER_QUERY = 2500;

async function mergeOfflinePackIntelIfOffline(
  ctx: AIContext,
  packParams: {
    locationIds: string[];
    userId: string | null;
    userLat: number | null;
    userLng: number | null;
    refDate: Date;
    refBucket: string;
  },
): Promise<AIContext> {
  if (await isOnlineForGuideIntel()) return ctx;
  const waterways = await getDownloadedWaterways();
  const agg = buildOfflinePackAggregatesFromDownloads(waterways, packParams);
  if (!agg) return ctx;
  return { ...ctx, guideOfflinePackAggregates: agg };
}

/** Prefer hour spoken in the question (e.g. "at 10", "at 10am") for time-bucket stats. */
export function parseReferenceDateFromQuestion(question: string, fallback: Date): Date {
  const m = question.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return fallback;
  let h = parseInt(m[1], 10);
  if (!Number.isFinite(h) || h < 0 || h > 23) return fallback;
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  const mins = m[2] != null ? parseInt(m[2], 10) : 0;
  const d = new Date(fallback);
  d.setHours(h, Number.isFinite(mins) ? mins : 0, 0, 0);
  return d;
}

type Row = { location_id: string | null; timestamp: string; quantity: number | null };

function bucketForIso(iso: string): string {
  return getTimeOfDay(new Date(iso));
}

function aggregateForLocations(
  rows: Row[],
  locationIds: Set<string>,
  refBucket: string,
): Map<string, { total: number; inBucket: number }> {
  const map = new Map<string, { total: number; inBucket: number }>();
  for (const id of locationIds) {
    map.set(id, { total: 0, inBucket: 0 });
  }
  for (const r of rows) {
    const lid = r.location_id;
    if (!lid || !locationIds.has(lid)) continue;
    const qty = Math.max(1, Math.floor(Number(r.quantity) || 1));
    const agg = map.get(lid)!;
    agg.total += qty;
    if (bucketForIso(r.timestamp) === refBucket) agg.inBucket += qty;
  }
  return map;
}

async function fetchCommunityRows(locationIds: string[], sinceIso: string): Promise<Row[]> {
  if (locationIds.length === 0) return [];
  const { data, error } = await supabase
    .from('community_catches')
    .select('location_id, timestamp, quantity')
    .in('location_id', locationIds)
    .gte('timestamp', sinceIso)
    .order('timestamp', { ascending: false })
    .limit(MAX_ROWS_PER_QUERY);
  if (error || !data) return [];
  return data as Row[];
}

async function fetchUserCatchRows(
  userId: string,
  locationIds: string[],
  sinceIso: string,
): Promise<Row[]> {
  if (locationIds.length === 0) return [];
  const { data, error } = await supabase
    .from('catches')
    .select('location_id, timestamp, quantity')
    .eq('user_id', userId)
    .in('location_id', locationIds)
    .gte('timestamp', sinceIso)
    .order('timestamp', { ascending: false })
    .limit(MAX_ROWS_PER_QUERY);
  if (error || !data) return [];
  return data as Row[];
}

type QuickReportTier = 'Hot' | 'Very Good' | 'Good' | 'Fair' | 'Quiet';

function buildSiblingRankInPrompt(
  locations: Location[],
  community: Map<string, { total: number; inBucket: number }>,
): Map<string, { rank: number; siblingCount: number }> {
  const byParent = new Map<string, Location[]>();
  for (const l of locations) {
    const key = l.parent_location_id ?? `__root:${l.id}`;
    const arr = byParent.get(key) ?? [];
    arr.push(l);
    byParent.set(key, arr);
  }
  const out = new Map<string, { rank: number; siblingCount: number }>();
  for (const [, group] of byParent) {
    if (group.length < 2) {
      for (const l of group) out.set(l.id, { rank: 0, siblingCount: 1 });
      continue;
    }
    const sorted = [...group].sort((a, b) => {
      const ta = community.get(a.id)?.total ?? 0;
      const tb = community.get(b.id)?.total ?? 0;
      if (tb !== ta) return tb - ta;
      return a.name.localeCompare(b.name);
    });
    sorted.forEach((l, i) => out.set(l.id, { rank: i, siblingCount: group.length }));
  }
  return out;
}

function quickReportTierFromAgg(
  total: number,
  inBucket: number,
  rank: number,
  siblingCount: number,
): QuickReportTier {
  const iRaw = internalRawFromCounts(total, inBucket);
  if (total <= 0) return 'Quiet';
  if (siblingCount >= 2 && rank === 0) {
    if (iRaw != null && iRaw >= 0.32) return 'Hot';
    return 'Very Good';
  }
  if (iRaw == null) return 'Good';
  if (iRaw >= 0.62) return 'Hot';
  if (iRaw >= 0.38) return 'Very Good';
  if (iRaw >= 0.18) return 'Good';
  return 'Fair';
}

function formatSummary(params: {
  locations: Location[];
  refBucket: string;
  refLabel: string;
  community: Map<string, { total: number; inBucket: number }>;
  user: Map<string, { total: number; inBucket: number }>;
  userLat: number | null;
  userLng: number | null;
  usedProximityFallback: boolean;
  mergedScreenLocation: boolean;
  catalogPickReason: 'mentioned' | 'near_you' | 'top_logged';
  showQuickReportForAngler: boolean;
}): string {
  const lines: string[] = [];
  lines.push(
    `Reference time for catch stats: ${params.refLabel} (time-of-day bucket: ${params.refBucket}).`,
  );
  lines.push(
    `Counts sum "quantity" from catch logs in the last ${CATCH_LOOKBACK_DAYS} days. "Same bucket" = catches logged in the same time-of-day window as the reference.`,
  );
  if (params.catalogPickReason === 'near_you') {
    lines.push(
      'These waters are the closest catalog locations to the angler (they asked where to fish without naming a specific water). Prefer recommending from this list by exact name.',
    );
  } else if (params.catalogPickReason === 'top_logged') {
    lines.push(
      'These waters have the most recent community fish logs in DriftGuide (location permission unavailable, so “near you” was not used). Prefer recommending from this list by exact name.',
    );
  } else if (params.usedProximityFallback) {
    lines.push(
      'No clear location names were matched in the message; using nearest catalog coordinates to the user for context.',
    );
  }
  if (params.mergedScreenLocation) {
    lines.push('Current screen / trip location was merged into this list when relevant.');
  }
  const sibRanks = params.showQuickReportForAngler
    ? buildSiblingRankInPrompt(params.locations, params.community)
    : null;
  lines.push('');
  for (const loc of params.locations) {
    const c = params.community.get(loc.id) ?? { total: 0, inBucket: 0 };
    const u = params.user.get(loc.id) ?? { total: 0, inBucket: 0 };
    let dist = '';
    if (params.userLat != null && params.userLng != null) {
      const km = distanceKmToLocation(loc, params.userLat, params.userLng);
      if (km != null) dist = ` ~${Math.round(km)} km from angler`;
    }
    let quick = '';
    if (sibRanks) {
      const sr = sibRanks.get(loc.id) ?? { rank: 0, siblingCount: 1 };
      const tier = quickReportTierFromAgg(c.total, c.inBucket, sr.rank, sr.siblingCount);
      quick = ` — Quick report (tell angler this label only): ${tier}`;
    }
    lines.push(
      `• ${loc.name} [catalog_id=${loc.id}]${dist}: community ${c.total} fish logged (${c.inBucket} in ${params.refBucket} bucket); this user ${u.total} (${u.inBucket} in same bucket).${quick}`,
    );
  }
  lines.push('');
  lines.push(
    'When comparing spots, use these logged totals only as a private ranking signal—do not quote counts to the angler.',
  );
  if (sibRanks) {
    lines.push(
      'Each bullet includes a Quick report tier (Hot, Very Good, Good, Fair, Quiet) from community logs vs the reference time bucket. When you name a catalog row, repeat that tier in plain words—do not quote fish counts.',
    );
  }
  lines.push(
    'When you name a water from this list, use its exact title as it appears before [catalog_id=] in <<spot:that-uuid:Exact title>> — never wrap that name in quotation marks in your answer.',
  );
  let maxCommunity = 0;
  for (const loc of params.locations) {
    const c = params.community.get(loc.id) ?? { total: 0, inBucket: 0 };
    maxCommunity = Math.max(maxCommunity, c.total);
  }
  const scaleNote = internalCatchScalingNote(maxCommunity);
  if (scaleNote) {
    lines.push('');
    lines.push(scaleNote);
  }
  return lines.join('\n');
}

/** Merge catalog rows that match place hints (e.g. "at strawberry") so children can expand even when the parent was not in the initial proximity/top list. */
function ensurePlaceHintLocationsInLocList(
  locList: Location[],
  catalog: Location[],
  hints: string[],
): Location[] {
  if (hints.length === 0) return locList;
  const seen = new Set(locList.map((l) => l.id));
  const extra: Location[] = [];
  for (const h of hints) {
    for (const m of filterLocationsByQuery(catalog, h).slice(0, 3)) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      extra.push(m);
    }
  }
  return extra.length > 0 ? [...locList, ...extra] : locList;
}

/**
 * Seeds parents for child expansion: linked extract wins, then hint name match, then catalog search from hints.
 * When `narrowTargets` is false, callers pass `locList` as seeds (expand every parent already in context).
 */
function resolveExpansionSeeds(
  locList: Location[],
  catalog: Location[],
  placeHints: string[],
  linkedIds: Set<string>,
  narrowTargets: boolean,
): Location[] {
  if (!narrowTargets) return [...locList];
  const seeds: Location[] = [];
  const seenSeed = new Set<string>();
  const hintLc = placeHints.map((h) => h.toLowerCase().trim());

  for (const l of locList) {
    if (linkedIds.has(l.id) && !seenSeed.has(l.id)) {
      seenSeed.add(l.id);
      seeds.push(l);
    }
  }
  for (const l of locList) {
    const n = l.name.toLowerCase();
    const matchesHint = hintLc.some((h) => {
      if (h.length < 3) return false;
      return n.includes(h) || n.split(/\s+/).some((w) => w.startsWith(h));
    });
    if (matchesHint && !seenSeed.has(l.id)) {
      seenSeed.add(l.id);
      seeds.push(l);
    }
  }
  if (seeds.length === 0 && hintLc.length > 0) {
    for (const h of placeHints) {
      for (const m of filterLocationsByQuery(catalog, h).slice(0, 3)) {
        if (!seenSeed.has(m.id)) {
          seenSeed.add(m.id);
          seeds.push(m);
        }
      }
    }
  }
  return seeds;
}

function expandChildrenOfSeedParents(locList: Location[], catalog: Location[], seeds: Location[]): Location[] {
  if (seeds.length === 0) return locList;
  const seen = new Set(locList.map((l) => l.id));
  const extra: Location[] = [];
  for (const p of seeds) {
    for (const c of catalog) {
      if (c.parent_location_id !== p.id) continue;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      extra.push(c);
    }
  }
  if (extra.length === 0) return locList;
  return [...locList, ...extra];
}

function formatParentCatalogLinesForSpotNormalization(locList: Location[], allCatalog: Location[]): string {
  const byId = new Map(allCatalog.map((l) => [l.id, l]));
  const locIds = new Set(locList.map((l) => l.id));
  const seenParent = new Set<string>();
  const lines: string[] = [];
  for (const l of locList) {
    if (!l.parent_location_id) continue;
    const p = byId.get(l.parent_location_id);
    if (!p || locIds.has(p.id) || seenParent.has(p.id)) continue;
    seenParent.add(p.id);
    lines.push(
      `• ${p.name} [catalog_id=${p.id}] (parent of other catalog rows in this prompt—use <<spot:…>> if you say this name).`,
    );
  }
  if (lines.length === 0) return '';
  return `\n--- Parent names (for river/system wording) ---\n${lines.join('\n')}`;
}

function formatChildHierarchyAppendix(
  locList: Location[],
  allCatalog: Location[],
  communityAgg: Map<string, { total: number; inBucket: number }>,
  userAgg: Map<string, { total: number; inBucket: number }>,
  refBucket: string,
): string {
  const byParent = new Map<string, Location[]>();
  for (const l of allCatalog) {
    if (!l.parent_location_id) continue;
    const arr = byParent.get(l.parent_location_id) ?? [];
    arr.push(l);
    byParent.set(l.parent_location_id, arr);
  }
  const lines: string[] = [];
  let any = false;
  for (const p of locList) {
    const kids = byParent.get(p.id);
    if (!kids || kids.length === 0) continue;
    any = true;
    const sortedKids = [...kids].sort((a, b) => {
      const ta = communityAgg.get(a.id)?.total ?? 0;
      const tb = communityAgg.get(b.id)?.total ?? 0;
      return tb - ta;
    });
    lines.push('');
    lines.push(
      `Parent ${p.name} [catalog_id=${p.id}] has ${sortedKids.length} child location(s) in DriftGuide. If they only named the parent (or a casual short name for it), pick one child to recommend using <<spot:childUUID:exact child name below>> and qualitative reasoning—do not quote fish counts to the angler.`,
    );
    for (const k of sortedKids) {
      const c = communityAgg.get(k.id) ?? { total: 0, inBucket: 0 };
      const u = userAgg.get(k.id) ?? { total: 0, inBucket: 0 };
      lines.push(
        `  • ${k.name} [catalog_id=${k.id}] type=${k.type} — community ${c.total} fish-equiv (60d), ${c.inBucket} in ${refBucket} bucket; this user ${u.total} (${u.inBucket} same bucket).`,
      );
    }
  }
  if (!any) return '';
  return (
    '\n--- Parent → child catalog (use when angler names a broad water) ---' +
    lines.join('\n') +
    '\nChildren are sorted by recent community activity (strongest signal first). Prefer the top child when choosing a specific access/reach unless conditions or the question clearly favor another.'
  );
}

function dedupeLinkedSpots(spots: { id: string; name: string }[]): { id: string; name: string }[] {
  const m = new Map<string, string>();
  for (const s of spots) {
    m.set(s.id, s.name);
  }
  return [...m.entries()].map(([id, name]) => ({ id, name }));
}

function buildMentionResolutionAppendix(resolutions: MentionResolution[]): string {
  if (resolutions.length === 0) return '';
  const lines: string[] = [
    '',
    '--- Location extract → catalog (LLM parse + fuzzy match; only DriftGuide rows below) ---',
  ];
  for (const r of resolutions) {
    if (r.kind === 'resolved') {
      lines.push(
        `• User phrase: ${r.mention} → catalog: ${r.location.name} [catalog_id=${r.location.id}] (confident match).`,
      );
    } else if (r.kind === 'ambiguous') {
      const opts = r.candidates.map((c) => `${c.location.name} [catalog_id=${c.location.id}]`).join(' OR ');
      lines.push(`• Phrase "${r.mention}" is ambiguous. Ask which they mean: ${opts}. Do not assume one water.`);
    } else {
      lines.push(
        `• "${r.mention}" has no confident catalog match — do not invent a place; suggest DriftGuide search or Hot Spots.`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * Match catalog locations from the question, load community + user catch aggregates, attach to AI context.
 */
export async function enrichContextWithLocationCatchData(
  base: AIContext,
  params: {
    question: string;
    locations: Location[];
    userId: string | null;
    userLat: number | null;
    userLng: number | null;
    referenceDate: Date;
  },
): Promise<AIContext> {
  const q = params.question.trim();
  if (!q) {
    const guideRegionLabel = await resolveRegionLabelAsync(params.userLat, params.userLng);
    const refDate = params.referenceDate;
    const refBucket = getTimeOfDay(refDate);
    const emptyQCtx: AIContext = {
      ...base,
      guideLocationCatchSummary: null,
      guideInternalMaxN: 0,
      guideRegionLabel,
    };
    const locIds = base.location?.id ? [base.location.id] : [];
    return mergeOfflinePackIntelIfOffline(emptyQCtx, {
      locationIds: locIds,
      userId: params.userId,
      userLat: params.userLat,
      userLng: params.userLng,
      refDate,
      refBucket,
    });
  }

  const guideRegionLabel = await resolveRegionLabelAsync(params.userLat, params.userLng);

  const extractPromise =
    params.locations.length > 0
      ? invokeGuideIntel({
          action: 'extract_locations',
          regionLabel: guideRegionLabel,
          question: q,
        }).then((raw) => parseExtractLocationsResponse(raw))
      : Promise.resolve([]);

  const wantPlace = questionWantsLocationRecommendation(q);
  const placeHints = extractPlaceHintsFromQuestion(q);

  const { locations: mentioned, usedProximityFallback: proxFromFind } = findMentionedLocations(
    q,
    params.locations,
    params.userLat,
    params.userLng,
    { proximityWhenNoMatch: wantPlace },
  );

  let catalogPickReason: 'mentioned' | 'near_you' | 'top_logged' = 'mentioned';
  let usedProximityFallback = proxFromFind;
  if (wantPlace && proxFromFind) {
    catalogPickReason = 'near_you';
  }

  let locList = [...mentioned];

  if (locList.length === 0 && wantPlace && params.locations.length > 0) {
    if (params.userLat != null && params.userLng != null) {
      const near = nearestCatalogLocations(params.locations, params.userLat, params.userLng, 10);
      if (near.length > 0) {
        locList = near;
        catalogPickReason = 'near_you';
        usedProximityFallback = true;
      }
    }
    if (locList.length === 0) {
      const catalogIds = new Set(params.locations.map((l) => l.id));
      const topIds = await fetchTopCatalogLocationIdsByRecentCatches(catalogIds, 12);
      const byId = new Map(params.locations.map((l) => [l.id, l]));
      locList = topIds.map((id) => byId.get(id)).filter((l): l is Location => l != null);
      if (locList.length < 10) {
        const have = new Set(locList.map((l) => l.id));
        for (const l of params.locations) {
          if (l.latitude == null || l.longitude == null) continue;
          if (have.has(l.id)) continue;
          locList.push(l);
          have.add(l.id);
          if (locList.length >= 10) break;
        }
      }
      catalogPickReason = 'top_logged';
      usedProximityFallback = true;
    }
  }

  const extracted = await extractPromise;
  const resolutions = resolveExtractedMentionsToCatalog(extracted, params.locations);

  const guideLinkedSpotsMut: { id: string; name: string }[] = [];
  const guideLocationAmbiguousMut: NonNullable<AIContext['guideLocationAmbiguous']> = [];

  for (const r of resolutions) {
    if (r.kind === 'resolved') {
      if (!locList.some((l) => l.id === r.location.id)) {
        locList.push(r.location);
      }
      guideLinkedSpotsMut.push({ id: r.location.id, name: r.location.name });
    } else if (r.kind === 'ambiguous') {
      guideLocationAmbiguousMut.push({
        extractedPhrase: r.mention,
        candidates: r.candidates.map((c) => ({ id: c.location.id, name: c.location.name })),
      });
    }
  }

  const guideLinkedSpotsDeduped = dedupeLinkedSpots(guideLinkedSpotsMut);
  const extractionAppendix = buildMentionResolutionAppendix(resolutions);

  const refDate = parseReferenceDateFromQuestion(q, params.referenceDate);
  const refBucket = getTimeOfDay(refDate);
  const refLabel = refDate.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  let mergedScreenLocation = false;
  const screenLoc = base.location;
  if (screenLoc?.id && !locList.some((l) => l.id === screenLoc.id)) {
    locList = [screenLoc, ...locList];
    mergedScreenLocation = true;
  }

  if (wantPlace && placeHints.length > 0) {
    locList = ensurePlaceHintLocationsInLocList(locList, params.locations, placeHints);
  }

  if (locList.length === 0) {
    const packIds = screenLoc?.id ? [screenLoc.id] : [];
    const packArgs = {
      locationIds: packIds,
      userId: params.userId,
      userLat: params.userLat,
      userLng: params.userLng,
      refDate,
      refBucket,
    };
    if (!extractionAppendix.trim()) {
      return mergeOfflinePackIntelIfOffline(
        {
          ...base,
          guideLocationCatchSummary: null,
          guideInternalMaxN: 0,
          guideRegionLabel,
          guideLocationAmbiguous:
            guideLocationAmbiguousMut.length > 0 ? guideLocationAmbiguousMut : undefined,
        },
        packArgs,
      );
    }
    return mergeOfflinePackIntelIfOffline(
      {
        ...base,
        guideLocationCatchSummary: extractionAppendix,
        guideInternalMaxN: 0,
        guideRegionLabel,
        guideLinkedSpots: guideLinkedSpotsDeduped.length > 0 ? guideLinkedSpotsDeduped : undefined,
        guideLocationAmbiguous:
          guideLocationAmbiguousMut.length > 0 ? guideLocationAmbiguousMut : undefined,
      },
      packArgs,
    );
  }

  /** Avoid expanding every nearby parent when the question is only "near me" with a broad catalog list. */
  const expandChildrenForWhere =
    wantPlace &&
    locList.length > 0 &&
    (placeHints.length > 0 ||
      guideLinkedSpotsDeduped.length > 0 ||
      (!usedProximityFallback && catalogPickReason === 'mentioned'));

  const idsBeforeChildInline = new Set(locList.map((l) => l.id));
  if (expandChildrenForWhere) {
    const linkedIds = new Set(guideLinkedSpotsDeduped.map((s) => s.id));
    const narrowTargets = placeHints.length > 0 || linkedIds.size > 0;
    const seeds = resolveExpansionSeeds(
      locList,
      params.locations,
      placeHints,
      linkedIds,
      narrowTargets,
    );
    locList = expandChildrenOfSeedParents(locList, params.locations, seeds);
  }
  const inlinedChildrenForWhere =
    expandChildrenForWhere && locList.some((l) => !idsBeforeChildInline.has(l.id));

  const ids = [...new Set(locList.map((l) => l.id))];
  const since = new Date();
  since.setDate(since.getDate() - CATCH_LOOKBACK_DAYS);
  const sinceIso = since.toISOString();

  const [communityRows, userRows] = await Promise.all([
    fetchCommunityRows(ids, sinceIso),
    params.userId ? fetchUserCatchRows(params.userId, ids, sinceIso) : Promise.resolve([]),
  ]);

  const idSetForAgg = new Set(ids);
  const communityAgg = aggregateForLocations(communityRows, idSetForAgg, refBucket);
  const userAgg = aggregateForLocations(userRows, idSetForAgg, refBucket);

  if (wantPlace) {
    locList = [...locList].sort((a, b) => {
      const ta = communityAgg.get(a.id)?.total ?? 0;
      const tb = communityAgg.get(b.id)?.total ?? 0;
      if (tb !== ta) return tb - ta;
      return a.name.localeCompare(b.name);
    });
  }

  const parentNameAppendix = formatParentCatalogLinesForSpotNormalization(locList, params.locations);

  const childAppendix = inlinedChildrenForWhere
    ? '\n--- Choosing among access points/reaches ---\nThe bullet list includes DriftGuide child locations under the water(s) this question targets. Each row ends with a Quick report tier—use those exact words (Hot, Very Good, Good, Fair, Quiet) when comparing spots; never quote raw fish counts. List named children with <<spot:UUID:exact catalog name>>. Rows are ordered by recent community activity (strongest first) for your ranking only.\nWhen the angler asks where to fish **on** a parent reservoir/river/lake and **multiple child rows** appear below for that parent, you must discuss **several distinct child access points** (<<spot:childUUID:exact child name>>)—not generic shore advice and **not** only the parent row. If a structured JSON block is requested, include **one entry per child** you recommend (up to 5), each with that child’s catalog UUID—do not collapse to a single parent-only entry when children are listed.'
    : formatChildHierarchyAppendix(
        locList,
        params.locations,
        communityAgg,
        userAgg,
        refBucket,
      );

  const summary =
    formatSummary({
      locations: locList,
      refBucket,
      refLabel,
      community: communityAgg,
      user: userAgg,
      userLat: params.userLat,
      userLng: params.userLng,
      usedProximityFallback,
      mergedScreenLocation,
      catalogPickReason,
      showQuickReportForAngler: inlinedChildrenForWhere,
    }) +
    extractionAppendix +
    parentNameAppendix +
    childAppendix;

  let maxCommunity = 0;
  for (const id of ids) {
    maxCommunity = Math.max(maxCommunity, communityAgg.get(id)?.total ?? 0);
  }

  return mergeOfflinePackIntelIfOffline(
    {
      ...base,
      guideLocationCatchSummary: summary,
      guideInternalMaxN: maxCommunity,
      guideRegionLabel,
      guideLinkedSpots: guideLinkedSpotsDeduped.length > 0 ? guideLinkedSpotsDeduped : undefined,
      guideLocationAmbiguous:
        guideLocationAmbiguousMut.length > 0 ? guideLocationAmbiguousMut : undefined,
    },
    {
      locationIds: ids,
      userId: params.userId,
      userLat: params.userLat,
      userLng: params.userLng,
      refDate,
      refBucket,
    },
  );
}
