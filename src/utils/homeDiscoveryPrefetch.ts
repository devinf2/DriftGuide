import * as ExpoLocation from 'expo-location';

import { useLocationFavoritesStore } from '@/src/stores/locationFavoritesStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { loadHomeHotSpotsBundle } from '@/src/utils/homeHotSpots';

/**
 * Best-effort warmup for Fish tab hatch + recommended spots (same bundle as home hooks).
 * Safe to call repeatedly; shares in-flight work and a short TTL cache with {@link loadHomeHotSpotsBundle}.
 */
export async function prefetchHomeDiscoveryBriefing(): Promise<void> {
  try {
    let { locations, fetchLocations } = useLocationStore.getState();
    if (locations.length === 0) {
      await fetchLocations();
      locations = useLocationStore.getState().locations;
    }
    if (locations.length === 0) return;

    const favoriteLocationIds = new Set(useLocationFavoritesStore.getState().ids);

    let userCoords: { latitude: number; longitude: number } | null = null;
    const perm = await ExpoLocation.requestForegroundPermissionsAsync().catch(() => null);
    if (perm?.status === 'granted') {
      const pos = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      }).catch(() => null);
      if (pos) {
        userCoords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      }
    }

    await loadHomeHotSpotsBundle(locations, userCoords, favoriteLocationIds, 0);
  } catch {
    /* non-fatal */
  }
}
