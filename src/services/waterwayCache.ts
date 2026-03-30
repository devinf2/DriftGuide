import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Location,
  WeatherData,
  WaterFlowData,
  CommunityCatchRow,
  ConditionsSnapshotRow,
  CatchRow,
} from '@/src/types';
import type { BoundingBox } from '@/src/types/boundingBox';
import { getWeather } from '@/src/services/weather';
import { getStreamFlow } from '@/src/services/waterFlow';
import { supabase } from '@/src/services/supabase';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';
import {
  fetchCatchesInBounds,
  fetchCommunityCatchesInBounds,
  fetchTripSummariesByIds,
  type OfflineTripSummary,
} from '@/src/services/sync';
import { mergeCachedCatchesFromRows } from '@/src/services/mapCatchLocalStore';
import { deleteDriftguideOfflinePack } from '@/src/services/mapboxOfflineRegion';

const DOWNLOADED_WATERWAYS_KEY = 'downloaded_waterways';

export interface WaterwayConditionsEntry {
  weather: WeatherData | null;
  waterFlow: WaterFlowData | null;
  fetchedAt: string;
}

export interface DownloadedWaterway {
  /** Primary location id, or synthetic `offline-custom-*` for map-only regions */
  locationId: string;
  locationIds: string[];
  locations: Location[];
  conditions: Record<string, WaterwayConditionsEntry>;
  /** Community catches inside {@link downloadBbox} when set; else legacy location-id scope */
  communityCatches: CommunityCatchRow[];
  conditionsSnapshots: ConditionsSnapshotRow[];
  /** User catches inside download bbox (full rows). */
  personalCatches?: CatchRow[];
  /** Own trip rows for {@link personalCatches} (keyed by trip id). */
  tripSummariesById?: Record<string, OfflineTripSummary>;
  downloadBbox?: BoundingBox;
  /** Paired Mapbox offline tile pack (`driftguide-map-*`). */
  mapPackName?: string | null;
  downloadedAt: string;
  lastRefreshedAt: string;
}

async function fetchConditionsSnapshotsByIds(
  snapshotIds: string[],
): Promise<ConditionsSnapshotRow[]> {
  if (snapshotIds.length === 0) return [];
  const { data, error } = await supabase.from('conditions_snapshots').select('*').in('id', snapshotIds);
  if (error || !data) return [];
  return data as ConditionsSnapshotRow[];
}

/** Fetch community catches by location ids (legacy entries without bbox). */
async function fetchCommunityCatchesForLocations(
  locationIds: string[],
): Promise<{ communityCatches: CommunityCatchRow[]; conditionsSnapshots: ConditionsSnapshotRow[] }> {
  if (locationIds.length === 0) {
    return { communityCatches: [], conditionsSnapshots: [] };
  }
  const { data: catches, error: catchesError } = await supabase
    .from('community_catches')
    .select('*')
    .in('location_id', locationIds)
    .order('timestamp', { ascending: false });

  if (catchesError || !catches || catches.length === 0) {
    return { communityCatches: catches ?? [], conditionsSnapshots: [] };
  }

  const snapshotIds = [
    ...new Set(
      (catches as CommunityCatchRow[])
        .map((c) => c.conditions_snapshot_id)
        .filter(Boolean),
    ),
  ] as string[];
  if (snapshotIds.length === 0) {
    return { communityCatches: catches as CommunityCatchRow[], conditionsSnapshots: [] };
  }

  const snapshots = await fetchConditionsSnapshotsByIds(snapshotIds);

  return {
    communityCatches: catches as CommunityCatchRow[],
    conditionsSnapshots: snapshots,
  };
}

async function getStored(): Promise<Record<string, DownloadedWaterway>> {
  const raw = await AsyncStorage.getItem(DOWNLOADED_WATERWAYS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, DownloadedWaterway>;
    for (const w of Object.values(parsed)) {
      if (!Array.isArray(w.communityCatches)) w.communityCatches = [];
      if (!Array.isArray(w.conditionsSnapshots)) w.conditionsSnapshots = [];
      if (!Array.isArray(w.personalCatches)) w.personalCatches = [];
      if (!w.tripSummariesById || typeof w.tripSummariesById !== 'object') w.tripSummariesById = {};
    }
    return parsed;
  } catch {
    return {};
  }
}

async function setStored(data: Record<string, DownloadedWaterway>): Promise<void> {
  await AsyncStorage.setItem(DOWNLOADED_WATERWAYS_KEY, JSON.stringify(data));
}

async function fetchConditionsForLocation(loc: Location): Promise<WaterwayConditionsEntry> {
  const lat = loc.latitude ?? null;
  const lng = loc.longitude ?? null;
  const stationId = (loc.metadata as Record<string, string> | null)?.usgs_station_id ?? null;

  const [weather, waterFlow] = await Promise.all([
    lat != null && lng != null ? getWeather(lat, lng) : Promise.resolve(null),
    stationId ? getStreamFlow(stationId) : Promise.resolve(null),
  ]);

  return {
    weather,
    waterFlow,
    fetchedAt: new Date().toISOString(),
  };
}

export type DownloadOfflineRegionBundleParams = {
  userId: string;
  bbox: BoundingBox;
  /** Locations to pull weather/flow for (shortcut tree or roots-in-bbox expansion). */
  locationsForConditions: Location[];
  /** AsyncStorage key (real primary id or `offline-custom-*`). */
  storageKey: string;
  mapPackName: string | null;
};

/**
 * Persist conditions for the given locations, user + community catches inside `bbox`,
 * and merge user catches into the global pin/full cache.
 */
export async function downloadOfflineRegionBundle(
  params: DownloadOfflineRegionBundleParams,
): Promise<void> {
  const { userId, bbox, locationsForConditions, storageKey, mapPackName } = params;
  const now = new Date().toISOString();
  const conditions: Record<string, WaterwayConditionsEntry> = {};

  for (const loc of locationsForConditions) {
    try {
      conditions[loc.id] = await fetchConditionsForLocation(loc);
    } catch (e) {
      console.warn('Failed to fetch conditions for location', loc.id, e);
      conditions[loc.id] = { weather: null, waterFlow: null, fetchedAt: now };
    }
  }

  const [personalRows, communityCatches] = await Promise.all([
    fetchCatchesInBounds(userId, bbox),
    fetchCommunityCatchesInBounds(bbox),
  ]);

  const tripIds = personalRows.map((r) => r.trip_id);
  const tripSummariesById = await fetchTripSummariesByIds(tripIds);

  await mergeCachedCatchesFromRows(personalRows);

  const snapshotIds = [
    ...new Set(
      communityCatches.map((c) => c.conditions_snapshot_id).filter(Boolean),
    ),
  ] as string[];
  const conditionsSnapshots = await fetchConditionsSnapshotsByIds(snapshotIds);

  const entry: DownloadedWaterway = {
    locationId: storageKey,
    locationIds: locationsForConditions.map((l) => l.id),
    locations: locationsForConditions,
    conditions,
    communityCatches,
    conditionsSnapshots,
    personalCatches: personalRows,
    tripSummariesById,
    downloadBbox: bbox,
    mapPackName: mapPackName ?? undefined,
    downloadedAt: now,
    lastRefreshedAt: now,
  };

  const data = await getStored();
  data[storageKey] = entry;
  await setStored(data);
}

export async function getDownloadedWaterways(): Promise<DownloadedWaterway[]> {
  const data = await getStored();
  return Object.values(data);
}

export async function getCachedConditions(
  locationId: string,
  parentLocationId?: string | null,
): Promise<WaterwayConditionsEntry | null> {
  const data = await getStored();
  for (const w of Object.values(data)) {
    if (!w.locationIds.includes(locationId) && w.locationId !== locationId) {
      if (parentLocationId && w.locationId !== parentLocationId) continue;
    }
    const entry =
      w.conditions[locationId] ?? (parentLocationId ? w.conditions[parentLocationId] : null);
    if (entry) return entry;
    const anyLoc = w.locations.find((l) => l.id === locationId || l.id === parentLocationId);
    if (anyLoc && w.conditions[anyLoc.id]) return w.conditions[anyLoc.id];
  }
  return null;
}

export async function refreshWaterway(
  primaryLocationId: string,
  userId?: string | null,
): Promise<void> {
  const data = await getStored();
  const w = data[primaryLocationId];
  if (!w) return;

  const now = new Date().toISOString();
  const conditions: Record<string, WaterwayConditionsEntry> = {};

  for (const loc of w.locations) {
    try {
      conditions[loc.id] = await fetchConditionsForLocation(loc);
    } catch (e) {
      console.warn('Failed to refresh conditions for location', loc.id, e);
      conditions[loc.id] = w.conditions[loc.id] ?? { weather: null, waterFlow: null, fetchedAt: now };
    }
  }

  let communityCatches = w.communityCatches;
  let conditionsSnapshots = w.conditionsSnapshots;
  let personalCatches = w.personalCatches ?? [];

  if (w.downloadBbox) {
    communityCatches = await fetchCommunityCatchesInBounds(w.downloadBbox);
    const snapIds = [
      ...new Set(communityCatches.map((c) => c.conditions_snapshot_id).filter(Boolean)),
    ] as string[];
    conditionsSnapshots = await fetchConditionsSnapshotsByIds(snapIds);
    if (userId) {
      personalCatches = await fetchCatchesInBounds(userId, w.downloadBbox);
      await mergeCachedCatchesFromRows(personalCatches);
    }
  } else {
    const legacy = await fetchCommunityCatchesForLocations(w.locationIds);
    communityCatches = legacy.communityCatches;
    conditionsSnapshots = legacy.conditionsSnapshots;
  }

  let tripSummariesById = w.tripSummariesById ?? {};
  if (userId && personalCatches.length > 0) {
    tripSummariesById = await fetchTripSummariesByIds(personalCatches.map((r) => r.trip_id));
  }

  data[primaryLocationId] = {
    ...w,
    conditions,
    communityCatches,
    conditionsSnapshots,
    personalCatches,
    tripSummariesById,
    lastRefreshedAt: now,
  };
  await setStored(data);
}

export async function refreshAllIfStale(
  maxAgeMs: number,
  userId?: string | null,
): Promise<void> {
  const data = await getStored();
  const now = Date.now();
  for (const w of Object.values(data)) {
    const refreshed = new Date(w.lastRefreshedAt).getTime();
    if (now - refreshed >= maxAgeMs) {
      try {
        await refreshWaterway(w.locationId, userId);
      } catch (e) {
        console.warn('Failed to refresh waterway', w.locationId, e);
      }
    }
  }
}

export async function removeDownloadedWaterway(primaryLocationId: string): Promise<void> {
  const data = await getStored();
  const w = data[primaryLocationId];
  if (w?.mapPackName) {
    try {
      await deleteDriftguideOfflinePack(w.mapPackName);
    } catch (e) {
      console.warn('[waterwayCache] delete map pack', e);
    }
  }
  delete data[primaryLocationId];
  await setStored(data);
}

/** After deleting a Mapbox pack from Profile, drop matching AsyncStorage bundle. */
export async function removeDownloadedDataForMapPack(mapPackName: string): Promise<void> {
  const data = await getStored();
  for (const [key, w] of Object.entries(data)) {
    if (w.mapPackName === mapPackName) {
      delete data[key];
      await setStored(data);
      return;
    }
  }
}

/** All locations from all downloaded waterways, for offline "Start trip" location list. */
export async function getLocationsForOfflineStart(): Promise<Location[]> {
  const waterways = await getDownloadedWaterways();
  const seen = new Set<string>();
  const out: Location[] = [];
  for (const w of waterways) {
    for (const loc of w.locations) {
      if (!seen.has(loc.id)) {
        seen.add(loc.id);
        out.push(loc);
      }
    }
  }
  return activeLocationsOnly(out).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/** Community catches and conditions for a downloaded waterway (for offline AI recommendations). */
export async function getCommunityDataForWaterway(primaryLocationId: string): Promise<{
  communityCatches: CommunityCatchRow[];
  conditionsSnapshots: ConditionsSnapshotRow[];
} | null> {
  const data = await getStored();
  const w = data[primaryLocationId];
  if (!w) return null;
  return {
    communityCatches: w.communityCatches ?? [],
    conditionsSnapshots: w.conditionsSnapshots ?? [],
  };
}
