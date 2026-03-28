import AsyncStorage from '@react-native-async-storage/async-storage';
import { Location, WeatherData, WaterFlowData, CommunityCatchRow, ConditionsSnapshotRow } from '@/src/types';
import { getWeather } from '@/src/services/weather';
import { getStreamFlow } from '@/src/services/waterFlow';
import { supabase } from '@/src/services/supabase';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';

const DOWNLOADED_WATERWAYS_KEY = 'downloaded_waterways';

export interface WaterwayConditionsEntry {
  weather: WeatherData | null;
  waterFlow: WaterFlowData | null;
  fetchedAt: string;
}

export interface DownloadedWaterway {
  /** Primary location id (parent or single location) */
  locationId: string;
  locationIds: string[];
  locations: Location[];
  conditions: Record<string, WaterwayConditionsEntry>;
  /** Anonymized community catches for this waterway (for offline AI recommendations) */
  communityCatches: CommunityCatchRow[];
  /** Conditions at catch time for each community catch (keyed by conditions_snapshot_id) */
  conditionsSnapshots: ConditionsSnapshotRow[];
  downloadedAt: string;
  lastRefreshedAt: string;
}

/** Fetch anonymized community catches for location ids and their conditions_snapshot rows. */
async function fetchCommunityCatchesForLocations(
  locationIds: string[]
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

  const snapshotIds = [...new Set((catches as CommunityCatchRow[]).map((c) => c.conditions_snapshot_id).filter(Boolean))] as string[];
  if (snapshotIds.length === 0) {
    return { communityCatches: catches as CommunityCatchRow[], conditionsSnapshots: [] };
  }

  const { data: snapshots, error: snapError } = await supabase
    .from('conditions_snapshots')
    .select('*')
    .in('id', snapshotIds);

  return {
    communityCatches: catches as CommunityCatchRow[],
    conditionsSnapshots: (snapError ? [] : (snapshots as ConditionsSnapshotRow[])) ?? [],
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

export async function getDownloadedWaterways(): Promise<DownloadedWaterway[]> {
  const data = await getStored();
  return Object.values(data);
}

export async function downloadWaterway(
  primaryLocationId: string,
  locations: Location[],
): Promise<void> {
  const now = new Date().toISOString();
  const conditions: Record<string, WaterwayConditionsEntry> = {};

  for (const loc of locations) {
    try {
      conditions[loc.id] = await fetchConditionsForLocation(loc);
    } catch (e) {
      console.warn('Failed to fetch conditions for location', loc.id, e);
      conditions[loc.id] = { weather: null, waterFlow: null, fetchedAt: now };
    }
  }

  const locationIds = locations.map((l) => l.id);
  const { communityCatches, conditionsSnapshots } = await fetchCommunityCatchesForLocations(locationIds);

  const entry: DownloadedWaterway = {
    locationId: primaryLocationId,
    locationIds,
    locations,
    conditions,
    communityCatches,
    conditionsSnapshots,
    downloadedAt: now,
    lastRefreshedAt: now,
  };

  const data = await getStored();
  data[primaryLocationId] = entry;
  await setStored(data);
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
    const entry = w.conditions[locationId] ?? (parentLocationId ? w.conditions[parentLocationId] : null);
    if (entry) return entry;
    const anyLoc = w.locations.find((l) => l.id === locationId || l.id === parentLocationId);
    if (anyLoc && w.conditions[anyLoc.id]) return w.conditions[anyLoc.id];
  }
  return null;
}

export async function refreshWaterway(primaryLocationId: string): Promise<void> {
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

  const { communityCatches, conditionsSnapshots } = await fetchCommunityCatchesForLocations(w.locationIds);

  data[primaryLocationId] = {
    ...w,
    conditions,
    communityCatches,
    conditionsSnapshots,
    lastRefreshedAt: now,
  };
  await setStored(data);
}

export async function refreshAllIfStale(maxAgeMs: number): Promise<void> {
  const data = await getStored();
  const now = Date.now();
  for (const w of Object.values(data)) {
    const refreshed = new Date(w.lastRefreshedAt).getTime();
    if (now - refreshed >= maxAgeMs) {
      try {
        await refreshWaterway(w.locationId);
      } catch (e) {
        console.warn('Failed to refresh waterway', w.locationId, e);
      }
    }
  }
}

export async function removeDownloadedWaterway(primaryLocationId: string): Promise<void> {
  const data = await getStored();
  delete data[primaryLocationId];
  await setStored(data);
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
