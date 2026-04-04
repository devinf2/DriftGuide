import { isPointInBoundingBox } from '@/src/types/boundingBox';
import { getDownloadedWaterways } from '@/src/services/waterwayCache';

/**
 * True if coordinates fall inside any saved offline region bbox, or (legacy) the location
 * id matches a downloaded waterway bundle without bbox.
 */
export async function isPlaceCoveredByOfflineDownloads(
  lat: number | null,
  lng: number | null,
  locationId?: string | null,
): Promise<boolean> {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }

  const waterways = await getDownloadedWaterways();

  for (const w of waterways) {
    if (w.downloadBbox && isPointInBoundingBox(lat, lng, w.downloadBbox)) {
      return true;
    }
    if (locationId) {
      if (w.locationId === locationId || w.locationIds.includes(locationId)) {
        return true;
      }
    }
  }

  return false;
}
