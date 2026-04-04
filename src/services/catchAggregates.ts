import { supabase } from '@/src/services/supabase';

const DEFAULT_DAYS = 60;

/** Sum quantity (min 1 per row) for community catches at a location in the lookback window. */
export async function fetchCommunityFishTotalForLocation(
  locationId: string,
  days: number = DEFAULT_DAYS,
): Promise<number> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const { data, error } = await supabase
      .from('community_catches')
      .select('quantity')
      .eq('location_id', locationId)
      .gte('timestamp', since.toISOString())
      .limit(5000);
    if (error || !data?.length) return 0;
    let sum = 0;
    for (const row of data) {
      const q = row as { quantity: number | null };
      sum += Math.max(1, Math.floor(Number(q.quantity) || 1));
    }
    return sum;
  } catch {
    return 0;
  }
}

export async function fetchCommunityFishTotalsForLocations(
  locationIds: string[],
  days: number = DEFAULT_DAYS,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = [...new Set(locationIds.filter(Boolean))];
  if (unique.length === 0) return map;
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const { data, error } = await supabase
      .from('community_catches')
      .select('location_id, quantity')
      .in('location_id', unique)
      .gte('timestamp', since.toISOString())
      .limit(8000);
    if (error || !data) return map;
    for (const row of data) {
      const r = row as { location_id: string | null; quantity: number | null };
      const lid = r.location_id;
      if (!lid) continue;
      const add = Math.max(1, Math.floor(Number(r.quantity) || 1));
      map.set(lid, (map.get(lid) ?? 0) + add);
    }
    return map;
  } catch {
    return map;
  }
}

/**
 * One query: recent community_catches rows, aggregated per location_id, filtered to catalog IDs.
 * Used when chat needs “where to fish” context without GPS (pick most-logged waters in-app).
 */
export async function fetchTopCatalogLocationIdsByRecentCatches(
  catalogLocationIds: Set<string>,
  limit: number,
  days: number = DEFAULT_DAYS,
): Promise<string[]> {
  if (catalogLocationIds.size === 0 || limit <= 0) return [];
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const { data, error } = await supabase
      .from('community_catches')
      .select('location_id, quantity')
      .gte('timestamp', since.toISOString())
      .limit(12000);
    if (error || !data) return [];
    const totals = new Map<string, number>();
    for (const row of data) {
      const r = row as { location_id: string | null; quantity: number | null };
      const lid = r.location_id;
      if (!lid || !catalogLocationIds.has(lid)) continue;
      totals.set(lid, (totals.get(lid) ?? 0) + Math.max(1, Math.floor(Number(r.quantity) || 1)));
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
  } catch {
    return [];
  }
}
