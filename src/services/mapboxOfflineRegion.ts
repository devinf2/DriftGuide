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

/** Prefix for app-created offline tile packs (list/delete in Profile). */
export const DRIFTGUIDE_OFFLINE_MAP_PACK_PREFIX = 'driftguide-map-';

export type DriftguideOfflineMapPack = {
  name: string;
  /** Serialized bounds from native OfflinePack when available. */
  bounds: string | null;
};

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
  getPacks?: () => Promise<unknown[]>;
  deletePack?: (name: string) => Promise<void>;
  getPack?: (name: string) => Promise<unknown>;
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

function packNameFromNative(pack: unknown): string {
  if (pack && typeof pack === 'object' && 'name' in pack) {
    const n = (pack as { name: unknown }).name;
    if (typeof n === 'string') return n;
  }
  return '';
}

function packBoundsFromNative(pack: unknown): string | null {
  if (pack && typeof pack === 'object' && 'bounds' in pack) {
    const b = (pack as { bounds: unknown }).bounds;
    if (typeof b === 'string') return b;
  }
  return null;
}

/**
 * Remove an existing pack with the same name so createPack replaces region tiles.
 */
export async function deletePackIfExists(name: string): Promise<void> {
  const om = loadOfflineManager();
  if (!om?.getPack || !om.deletePack) return;
  try {
    const existing = await om.getPack(name);
    if (existing) await om.deletePack(name);
  } catch {
    // ignore — pack may not exist
  }
}

/** Mapbox tile packs created by DriftGuide offline flow (`driftguide-map-*`). */
export async function listDriftguideOfflinePacks(): Promise<DriftguideOfflineMapPack[]> {
  const om = loadOfflineManager();
  if (!om?.getPacks) return [];
  try {
    const packs = await om.getPacks();
    const out: DriftguideOfflineMapPack[] = [];
    for (const p of packs) {
      const name = packNameFromNative(p);
      if (name.startsWith(DRIFTGUIDE_OFFLINE_MAP_PACK_PREFIX)) {
        out.push({ name, bounds: packBoundsFromNative(p) });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    console.warn('[mapboxOfflineRegion] getPacks', e);
    return [];
  }
}

export async function deleteDriftguideOfflinePack(name: string): Promise<void> {
  if (!name.startsWith(DRIFTGUIDE_OFFLINE_MAP_PACK_PREFIX)) {
    throw new Error('Invalid offline pack name');
  }
  const om = loadOfflineManager();
  if (!om?.deletePack) {
    throw new Error('Mapbox offline is not available (native build required).');
  }
  await om.deletePack(name);
}

export function isMapboxOfflineAvailable(): boolean {
  return loadOfflineManager() != null;
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

  if (name.startsWith(DRIFTGUIDE_OFFLINE_MAP_PACK_PREFIX)) {
    await deletePackIfExists(name);
  }

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
