import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Location } from '@/src/types';
import { normalizeHomeStateCode } from '@/src/utils/homeStateNormalize';
import { US_STATE_BOUNDS } from '@/src/data/usStateBounds';
import { activeLocationsOnly, locationsVisibleToViewer } from '@/src/utils/locationVisibility';

const KEY = (userId: string) => `driftguide_offline_loc_snapshot_v1_${userId}`;

function pointInStateBBox(
  lat: number,
  lng: number,
  code: string,
): boolean {
  const b = US_STATE_BOUNDS[code];
  if (!b) return false;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

/** Filter catalog rows to those inside the user’s home state (by bbox). */
export function filterLocationsByHomeState(
  locations: Location[],
  homeStateRaw: string | null | undefined,
): Location[] {
  const code = normalizeHomeStateCode(homeStateRaw ?? null);
  if (!code) return [];
  const active = activeLocationsOnly(locations);
  return active.filter((loc) => {
    const lat = loc.latitude;
    const lng = loc.longitude;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return false;
    }
    return pointInStateBBox(lat, lng, code);
  });
}

export async function saveOfflineLocationsSnapshot(
  userId: string,
  locations: Location[],
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(KEY(userId), JSON.stringify(locations));
  } catch {
    /* ignore */
  }
}

export async function loadOfflineLocationsSnapshot(userId: string): Promise<Location[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(KEY(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Location[];
    if (!Array.isArray(parsed)) return [];
    return locationsVisibleToViewer(activeLocationsOnly(parsed), userId);
  } catch {
    return [];
  }
}
