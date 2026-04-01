import * as ExpoLocation from 'expo-location';

const LAST_KNOWN_MAX_AGE_MS = 300_000; // 5 min — good enough to stamp start/end without blocking UI

/**
 * Fast bookmark coords for optimistic trip UI: last known fix only (no active GPS wait).
 * Use {@link captureTripBookmarkCoords} in the background to refine when accuracy matters.
 */
export async function captureTripBookmarkCoordsFast(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  try {
    const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const last = await ExpoLocation.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    if (!last?.coords) return null;
    return {
      latitude: last.coords.latitude,
      longitude: last.coords.longitude,
    };
  } catch {
    return null;
  }
}

/**
 * GPS at trip start/end: request permission, prefer a fresh fix, fall back to a recent
 * last-known position if the current request fails (simulator / weak signal).
 */
export async function captureTripBookmarkCoords(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  try {
    const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    try {
      const fresh = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      return {
        latitude: fresh.coords.latitude,
        longitude: fresh.coords.longitude,
      };
    } catch {
      const last = await ExpoLocation.getLastKnownPositionAsync({ maxAge: 600_000 });
      if (!last?.coords) return null;
      return {
        latitude: last.coords.latitude,
        longitude: last.coords.longitude,
      };
    }
  } catch {
    return null;
  }
}
