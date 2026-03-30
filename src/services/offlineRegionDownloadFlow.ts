import type { Location } from '@/src/types';
import type { BoundingBox } from '@/src/types/boundingBox';
import type { MapboxBasemapId } from '@/src/constants/mapbox';
import { mapboxStyleURLForBasemap } from '@/src/constants/mapbox';
import {
  downloadOfflineMapRegion,
  isMapboxOfflineAvailable,
  type OfflineDownloadProgress,
} from '@/src/services/mapboxOfflineRegion';
import { downloadOfflineRegionBundle } from '@/src/services/waterwayCache';

export type ExecuteOfflineRegionDownloadArgs = {
  userId: string;
  liveBbox: BoundingBox;
  locationsForConditions: Location[];
  storageKey: string;
  mapPackName: string;
  basemapId: MapboxBasemapId;
};

export type ExecuteOfflineRegionDownloadResult = { tilesOk: boolean };

/**
 * Mapbox tiles (when native) + AsyncStorage bundle for the bbox.
 */
export async function executeOfflineRegionDownload(
  args: ExecuteOfflineRegionDownloadArgs,
  onTileProgress?: (percentage: number) => void,
): Promise<ExecuteOfflineRegionDownloadResult> {
  const tilesOk = isMapboxOfflineAvailable();
  if (tilesOk) {
    await downloadOfflineMapRegion(
      {
        bbox: args.liveBbox,
        name: args.mapPackName,
        styleURL: mapboxStyleURLForBasemap(args.basemapId),
      },
      onTileProgress
        ? (p: OfflineDownloadProgress) => onTileProgress(p.percentage)
        : undefined,
    );
  }

  await downloadOfflineRegionBundle({
    userId: args.userId,
    bbox: args.liveBbox,
    locationsForConditions: args.locationsForConditions,
    storageKey: args.storageKey,
    mapPackName: tilesOk ? args.mapPackName : null,
  });

  return { tilesOk };
}
