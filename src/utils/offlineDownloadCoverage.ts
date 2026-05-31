import { isPointInBoundingBox } from '@/src/types/boundingBox';
import { getDownloadedWaterways, type DownloadedWaterway } from '@/src/services/waterwayCache';

/**
 * Returns the saved offline bundle covering this place, if any.
 */
export async function findOfflineDownloadForPlace(
  lat: number | null,
  lng: number | null,
  locationId?: string | null,
): Promise<DownloadedWaterway | null> {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const waterways = await getDownloadedWaterways();

  for (const w of waterways) {
    if (w.downloadBbox && isPointInBoundingBox(lat, lng, w.downloadBbox)) {
      return w;
    }
    if (locationId) {
      if (w.locationId === locationId || w.locationIds.includes(locationId)) {
        return w;
      }
    }
  }

  return null;
}

/**
 * True if coordinates fall inside any saved offline region bbox, or (legacy) the location
 * id matches a downloaded waterway bundle without bbox.
 */
export async function isPlaceCoveredByOfflineDownloads(
  lat: number | null,
  lng: number | null,
  locationId?: string | null,
): Promise<boolean> {
  return (await findOfflineDownloadForPlace(lat, lng, locationId)) != null;
}
