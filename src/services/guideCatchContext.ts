import type { Location } from '@/src/types';
import type { AIContext } from '@/src/services/ai';
import { getTimeOfDay } from '@/src/services/ai';
import { supabase } from '@/src/services/supabase';
import { findMentionedLocations, distanceKmToLocation } from '@/src/utils/mentionedLocations';

const CATCH_LOOKBACK_DAYS = 60;
const MAX_ROWS_PER_QUERY = 2500;

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
}): string {
  const lines: string[] = [];
  lines.push(
    `Reference time for catch stats: ${params.refLabel} (time-of-day bucket: ${params.refBucket}).`,
  );
  lines.push(
    `Counts sum "quantity" from catch logs in the last ${CATCH_LOOKBACK_DAYS} days. "Same bucket" = catches logged in the same time-of-day window as the reference.`,
  );
  if (params.usedProximityFallback) {
    lines.push(
      'No clear location names were matched in the message; using nearest catalog coordinates to the user for context.',
    );
  }
  if (params.mergedScreenLocation) {
    lines.push('Current screen / trip location was merged into this list when relevant.');
  }
  lines.push('');
  for (const loc of params.locations) {
    const c = params.community.get(loc.id) ?? { total: 0, inBucket: 0 };
    const u = params.user.get(loc.id) ?? { total: 0, inBucket: 0 };
    let dist = '';
    if (params.userLat != null && params.userLng != null) {
      const km = distanceKmToLocation(loc, params.userLat, params.userLng);
      if (km != null) dist = ` ~${Math.round(km)} km from angler`;
    }
    lines.push(
      `• ${loc.name}${dist}: community ${c.total} fish logged (${c.inBucket} in ${params.refBucket} bucket); this user ${u.total} (${u.inBucket} in same bucket).`,
    );
  }
  lines.push('');
  lines.push(
    'When comparing spots, weight these logged totals explicitly. If a count is 0, say data is thin and avoid overstating.',
  );
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
    return { ...base, guideLocationCatchSummary: null };
  }

  const { locations: mentioned, usedProximityFallback } = findMentionedLocations(
    q,
    params.locations,
    params.userLat,
    params.userLng,
  );

  const refDate = parseReferenceDateFromQuestion(q, params.referenceDate);
  const refBucket = getTimeOfDay(refDate);
  const refLabel = refDate.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  let locList = [...mentioned];
  let mergedScreenLocation = false;
  const screenLoc = base.location;
  if (screenLoc?.id && !locList.some((l) => l.id === screenLoc.id)) {
    locList = [screenLoc, ...locList];
    mergedScreenLocation = true;
  }

  if (locList.length === 0) {
    return { ...base, guideLocationCatchSummary: null };
  }

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

  const summary = formatSummary({
    locations: locList,
    refBucket,
    refLabel,
    community: communityAgg,
    user: userAgg,
    userLat: params.userLat,
    userLng: params.userLng,
    usedProximityFallback,
    mergedScreenLocation,
  });

  return { ...base, guideLocationCatchSummary: summary };
}
