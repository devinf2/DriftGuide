/**
 * Offline map downloads for @rnmapbox/maps.
 *
 * The JS API is named `offlineManager.createPack`, but on Mapbox Maps SDK v10+ the native
 * implementation (RNMBXOfflineModule on iOS/Android) uses **TileStore.loadTileRegion** plus
 * **OfflineManager.loadStylePack** — not the legacy OfflineRegion database API. This is the
 * supported React Native surface until/unless rnmapbox exposes TileStore methods directly.
 *
 * @see https://github.com/rnmapbox/maps/blob/main/ios/RNMBX/Offline/RNMBXOfflineModule.swift
 */

import {
  SAMPLE_OFFLINE_BOUNDING_BOX,
  SAMPLE_OFFLINE_MAX_ZOOM,
  SAMPLE_OFFLINE_MIN_ZOOM,
  SAMPLE_OFFLINE_PACK_NAME,
  SAMPLE_OFFLINE_STYLE_URL,
} from '@/src/constants/offlineSampleRegion';
import { mapboxCreatePackBoundsFromBoundingBox, type BoundingBox } from '@/src/types/boundingBox';
import { isRnMapboxNativeLinked } from '@/src/utils/rnmapboxNative';

type OfflineManagerLike = {
  createPack: (
    options: {
      name: string;
      styleURL: string;
      bounds: [[number, number], [number, number]];
      minZoom?: number;
      maxZoom?: number;
    },
    onProgress: (pack: unknown, status: { percentage?: number }) => void,
    onError?: (pack: unknown, err: { message?: string }) => void,
  ) => Promise<void>;
};

function loadOfflineManager(): OfflineManagerLike | null {
  if (!isRnMapboxNativeLinked()) return null;
  try {
    const m = require('@rnmapbox/maps') as {
      default?: OfflineManagerLike & { offlineManager?: OfflineManagerLike };
      offlineManager?: OfflineManagerLike;
    };
    const ns = m.default ?? m;
    return ns.offlineManager ?? null;
  } catch {
    return null;
  }
}

export type OfflineDownloadProgress = {
  percentage: number;
  state?: string;
};

export type DownloadOfflineMapRegionOptions = {
  bbox: BoundingBox;
  /** Defaults to a timestamp-based id when omitted (avoid collisions for ad-hoc viewport packs). */
  name?: string;
  styleURL?: string;
  minZoom?: number;
  maxZoom?: number;
};

/**
 * Download map tiles for a geographic bbox (same shape as Supabase / cache queries).
 */
export async function downloadOfflineMapRegion(
  options: DownloadOfflineMapRegionOptions,
  onProgress?: (p: OfflineDownloadProgress) => void,
): Promise<void> {
  const om = loadOfflineManager();
  if (!om) {
    throw new Error('Mapbox offline is not available (native build required).');
  }

  const {
    bbox,
    name = `driftguide-offline-${Date.now()}`,
    styleURL = SAMPLE_OFFLINE_STYLE_URL,
    minZoom = SAMPLE_OFFLINE_MIN_ZOOM,
    maxZoom = SAMPLE_OFFLINE_MAX_ZOOM,
  } = options;

  await om.createPack(
    {
      name,
      styleURL,
      bounds: mapboxCreatePackBoundsFromBoundingBox(bbox),
      minZoom,
      maxZoom,
    },
    (_pack, status) => {
      onProgress?.({
        percentage: typeof status.percentage === 'number' ? status.percentage : 0,
      });
    },
    (_pack, err) => {
      console.warn('[mapboxOfflineRegion]', err?.message ?? err);
    },
  );
}

/** MVP default: Utah Valley sample {@link SAMPLE_OFFLINE_BOUNDING_BOX}. */
export async function downloadSampleOfflineRegion(
  onProgress?: (p: OfflineDownloadProgress) => void,
): Promise<void> {
  await downloadOfflineMapRegion(
    {
      bbox: SAMPLE_OFFLINE_BOUNDING_BOX,
      name: SAMPLE_OFFLINE_PACK_NAME,
    },
    onProgress,
  );
}
