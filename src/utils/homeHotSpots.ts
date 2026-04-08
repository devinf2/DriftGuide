import { getTopFishingSpots, type SpotSuggestion } from '@/src/services/ai';
import { fetchCommunityFishTotalsForLocations } from '@/src/services/catchAggregates';
import { fetchAllLocationConditions } from '@/src/services/conditions';
import { haversineDistance } from '@/src/services/locationService';
import { Location, LocationConditions } from '@/src/types';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';

/** When two spots are within this distance (km), apply favorite tie-break. */
const HOME_HOTSPOT_DISTANCE_TIE_EPS_KM = 0.5;

/**
 * Max how many geotagged waters we send to the hot-spot model (smaller = closer-only).
 * Final UI still shows at most 3, sorted by distance.
 */
export const MAX_HOME_HOTSPOT_POOL = 8;
/** Prefer at least this many candidates before tightening radius (else expand tiers). */
export const MIN_HOME_HOTSPOT_POOL = 3;
/**
 * Start with the tightest radius and only widen if there are not enough waters.
 * Values in km (~28 / 50 / 75 / 110 mi).
 */
export const HOME_HOTSPOT_RADIUS_TIERS_KM = [45, 80, 120, 180] as const;

export type HomeHotSpotData = {
  suggestion: SpotSuggestion;
  location: Location;
  conditions: LocationConditions;
  /** km from user when location permission + coords available */
  distanceKm: number | null;
  /** Community fish-equivalent in lookback window */
  communityFishN?: number;
};

export type WaterConditionsBrief = {
  name: string;
  conditions: LocationConditions;
};

/** Distance from user for display; null if unknown. */
export function distanceKmForLocation(
  loc: Location,
  userCoords: { latitude: number; longitude: number } | null,
): number | null {
  if (!userCoords) return null;
  const lat = loc.latitude ?? null;
  const lng = loc.longitude ?? null;
  if (lat == null || lng == null) return null;
  return haversineDistance(userCoords.latitude, userCoords.longitude, lat, lng);
}

export function formatDistanceLabel(km: number | null): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  const mi = km * 0.621371;
  if (mi < 0.25) return 'Nearby';
  if (mi < 10) return `${Math.round(mi * 10) / 10} mi away`;
  return `${Math.round(mi)} mi away`;
}

/**
 * Prefer locations near the user: strict distance tiers, then nearest-N cap for the model.
 * Falls back to all top-level waters when we have no GPS fix or no coordinates on file.
 */
export function selectLocationsForHomeHotSpots(
  topLevel: Location[],
  userCoords: { latitude: number; longitude: number } | null,
): Location[] {
  const withCoords = topLevel.filter(
    (l) => l.latitude != null && l.longitude != null,
  ) as (Location & { latitude: number; longitude: number })[];
  if (!userCoords || withCoords.length === 0) {
    return topLevel;
  }
  const distKm = (l: (typeof withCoords)[number]) =>
    haversineDistance(userCoords.latitude, userCoords.longitude, l.latitude, l.longitude);

  const sorted = [...withCoords].sort((a, b) => distKm(a) - distKm(b));

  for (const maxKm of HOME_HOTSPOT_RADIUS_TIERS_KM) {
    const inBand = sorted.filter((l) => distKm(l) <= maxKm);
    if (inBand.length >= MIN_HOME_HOTSPOT_POOL) {
      return inBand.slice(0, MAX_HOME_HOTSPOT_POOL);
    }
  }
  return sorted.slice(0, MAX_HOME_HOTSPOT_POOL);
}

function buildHotSpotListFromSuggestions(
  spotsToUse: Location[],
  conditionsMap: Map<string, LocationConditions>,
  suggestions: SpotSuggestion[],
  userCoords: { latitude: number; longitude: number } | null,
  communityFishByLocationId: Map<string, number>,
  favoriteLocationIds?: ReadonlySet<string>,
): HomeHotSpotData[] {
  const list: HomeHotSpotData[] = [];
  const seenIds = new Set<string>();
  const suggestionName = (s: SpotSuggestion) => s.locationName.toLowerCase().trim();
  const primaryPart = (s: SpotSuggestion) =>
    suggestionName(s).split(/[\s]*[-–—][\s]*/)[0]?.trim() ?? suggestionName(s);
  for (const suggestion of suggestions.slice(0, 6)) {
    const loc = spotsToUse.find((l) => {
      const ln = l.name.toLowerCase();
      const sn = suggestionName(suggestion);
      const pp = primaryPart(suggestion);
      return ln === sn || sn.includes(ln) || ln.includes(pp) || pp.includes(ln);
    });
    if (!loc || seenIds.has(loc.id)) continue;
    const conditions =
      conditionsMap.get(loc.id) ??
      (loc.parent_location_id ? conditionsMap.get(loc.parent_location_id) : undefined);
    const conditionsToUse =
      conditions ?? (conditionsMap.size > 0 ? Array.from(conditionsMap.values())[0] : undefined);
    if (conditionsToUse) {
      seenIds.add(loc.id);
      list.push({
        suggestion,
        location: loc,
        conditions: conditionsToUse,
        distanceKm: distanceKmForLocation(loc, userCoords),
        communityFishN: communityFishByLocationId.get(loc.id) ?? 0,
      });
    }
  }
  const fav = favoriteLocationIds;
  const cmpDistance = (a: HomeHotSpotData, b: HomeHotSpotData) => {
    const ad = a.distanceKm;
    const bd = b.distanceKm;
    if (ad == null && bd == null) {
      const fa = fav?.has(a.location.id) === true;
      const fb = fav?.has(b.location.id) === true;
      if (fa && !fb) return -1;
      if (!fa && fb) return 1;
      return 0;
    }
    if (ad == null) return 1;
    if (bd == null) return -1;
    if (Math.abs(ad - bd) > HOME_HOTSPOT_DISTANCE_TIE_EPS_KM) return ad - bd;
    const fa = fav?.has(a.location.id) === true;
    const fb = fav?.has(b.location.id) === true;
    if (fa && !fb) return -1;
    if (!fa && fb) return 1;
    return ad - bd;
  };
  list.sort(cmpDistance);
  let top = list.slice(0, 3);
  if (top.length === 0 && spotsToUse.length > 0) {
    const fallback: HomeHotSpotData[] = [];
    for (const loc of spotsToUse) {
      const conditions =
        conditionsMap.get(loc.id) ??
        (loc.parent_location_id ? conditionsMap.get(loc.parent_location_id) : undefined);
      if (!conditions) continue;
      fallback.push({
        suggestion: {
          locationName: loc.name,
          reason: '',
          confidence: 0.5,
        },
        location: loc,
        conditions,
        distanceKm: distanceKmForLocation(loc, userCoords),
        communityFishN: communityFishByLocationId.get(loc.id) ?? 0,
      });
    }
    fallback.sort(cmpDistance);
    top = fallback.slice(0, 3);
  }
  return top;
}

function buildWatersForRegionalBriefing(
  spotsToUse: Location[],
  conditionsMap: Map<string, LocationConditions>,
  maxWaters: number,
): WaterConditionsBrief[] {
  const out: WaterConditionsBrief[] = [];
  for (const loc of spotsToUse.slice(0, maxWaters)) {
    const conditions =
      conditionsMap.get(loc.id) ??
      (loc.parent_location_id ? conditionsMap.get(loc.parent_location_id) : undefined);
    if (conditions) {
      out.push({ name: loc.name, conditions });
    }
  }
  return out;
}

export type FetchHomeHotSpotsResult = {
  hotSpotList: HomeHotSpotData[];
  watersForRegionalBriefing: WaterConditionsBrief[];
};

/**
 * Fetches conditions and AI-ranked hot spots for home. Used by useHomeHotSpots.
 */
export async function fetchHomeHotSpotsData(
  locations: Location[],
  userCoords: { latitude: number; longitude: number } | null,
  favoriteLocationIds?: ReadonlySet<string>,
): Promise<FetchHomeHotSpotsResult | null> {
  const topLevel = activeLocationsOnly(locations).filter((l) => !l.parent_location_id);
  if (topLevel.length === 0) {
    return { hotSpotList: [], watersForRegionalBriefing: [] };
  }
  const spotsToUse = selectLocationsForHomeHotSpots(topLevel, userCoords);
  if (spotsToUse.length === 0) {
    return { hotSpotList: [], watersForRegionalBriefing: [] };
  }
  const conditionsMap = await fetchAllLocationConditions(spotsToUse);
  const communityFishByLocationId = await fetchCommunityFishTotalsForLocations(
    spotsToUse.map((s) => s.id),
  );
  const watersForRegionalBriefing = buildWatersForRegionalBriefing(
    spotsToUse,
    conditionsMap,
    MAX_HOME_HOTSPOT_POOL,
  );
  const suggestions = await getTopFishingSpots(spotsToUse, conditionsMap, undefined, {
    userLat: userCoords?.latitude ?? null,
    userLng: userCoords?.longitude ?? null,
    communityFishByLocationId,
    favoriteLocationIds,
  });
  const hotSpotList = buildHotSpotListFromSuggestions(
    spotsToUse,
    conditionsMap,
    suggestions,
    userCoords,
    communityFishByLocationId,
    favoriteLocationIds,
  );
  return { hotSpotList, watersForRegionalBriefing };
}
