import { supabase } from './supabase';

export type LocationPublicTripRatingRow = {
  trip_id: string;
  /** Sort / “reviewed” time (end_time, else start_time). */
  rated_at: string;
  start_time: string;
  total_fish: number;
  rating: number;
  notes: string | null;
  user_reported_clarity: string | null;
  display_name: string;
  /** Profile photo: `profiles.avatar_url` (joined via `trips.user_id`). */
  avatar_url: string | null;
};

function parseRpcInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return 0;
}

function normalizeRow(raw: Record<string, unknown>): LocationPublicTripRatingRow {
  const clarity = raw.user_reported_clarity;
  const start = raw.start_time;
  return {
    trip_id: String(raw.trip_id ?? ''),
    rated_at: String(raw.rated_at ?? ''),
    start_time: start == null ? '' : String(start),
    total_fish: parseRpcInt(raw.total_fish),
    rating: parseRpcInt(raw.rating),
    notes: raw.notes == null ? null : String(raw.notes),
    user_reported_clarity:
      clarity == null || clarity === '' ? null : String(clarity),
    display_name: String(raw.display_name ?? 'Angler'),
    avatar_url: raw.avatar_url == null ? null : String(raw.avatar_url),
  };
}

function parseFeedPayload(data: unknown): { showCommunityTab: boolean; rows: LocationPublicTripRatingRow[] } | null {
  if (data == null) return null;
  let parsed: unknown = data;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const n = parseRpcInt(o.recent_30d_count);
  const showCommunityTab = n > 0;
  const rawItems = o.items;
  if (!Array.isArray(rawItems)) {
    return showCommunityTab ? { showCommunityTab: true, rows: [] } : { showCommunityTab: false, rows: [] };
  }
  const rows = rawItems
    .filter((x): x is Record<string, unknown> => x != null && typeof x === 'object' && !Array.isArray(x))
    .map(normalizeRow);
  if (!showCommunityTab) return { showCommunityTab: false, rows: [] };
  return { showCommunityTab: true, rows };
}

/**
 * Community tab: one RPC returns { recent_30d_count, items }.
 * Tab shows only when recent_30d_count > 0; items list all qualifying trips at this location_id.
 */
export async function fetchLocationCommunityRatings(
  locationId: string,
): Promise<{ showCommunityTab: boolean; rows: LocationPublicTripRatingRow[] }> {
  const { data, error } = await supabase.rpc('location_community_ratings_feed', {
    p_location_id: locationId,
    p_limit: 100,
  });

  if (error) {
    console.warn('[DriftGuide] Community feed RPC failed:', error.message, error.code ?? '');
    return { showCommunityTab: false, rows: [] };
  }

  const parsed = parseFeedPayload(data);
  return parsed ?? { showCommunityTab: false, rows: [] };
}

/** Mean of 1–5 trip ratings from feed rows; null if none. */
export function averagePublicTripRatingFromRows(rows: LocationPublicTripRatingRow[]): number | null {
  const vals = rows
    .map((r) => r.rating)
    .filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export type LocationPublicRatingSummary = {
  locationId: string;
  ratingAvg: number;
  ratingCount: number;
};

/**
 * One RPC: avg + count of public rated trips per location (all time), for home cards.
 */
export async function fetchLocationPublicRatingSummaries(
  locationIds: string[],
): Promise<Map<string, LocationPublicRatingSummary>> {
  const out = new Map<string, LocationPublicRatingSummary>();
  const unique = [...new Set(locationIds.filter(Boolean))];
  if (unique.length === 0) return out;

  const { data, error } = await supabase.rpc('location_public_rating_summaries', {
    p_location_ids: unique,
  });

  if (error) {
    console.warn('[DriftGuide] location_public_rating_summaries failed:', error.message, error.code ?? '');
    return out;
  }

  const raw = Array.isArray(data) ? data : typeof data === 'string' ? tryParseJsonArray(data) : null;
  if (!Array.isArray(raw)) return out;

  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const id = o.location_id == null ? '' : String(o.location_id);
    if (!id) continue;
    const avgRaw = o.rating_avg;
    const countRaw = o.rating_count;
    const ratingAvg =
      typeof avgRaw === 'number'
        ? avgRaw
        : typeof avgRaw === 'string'
          ? Number(avgRaw)
          : NaN;
    const ratingCount =
      typeof countRaw === 'number' && Number.isFinite(countRaw)
        ? Math.trunc(countRaw)
        : parseRpcInt(countRaw);
    if (!Number.isFinite(ratingAvg) || ratingCount <= 0) continue;
    out.set(id, { locationId: id, ratingAvg, ratingCount });
  }
  return out;
}

function tryParseJsonArray(s: string): unknown[] | null {
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
