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
import { resolveOfflineMaxZoom } from '@/src/utils/offlineTileEstimate';

/** Prefix for app-created offline tile packs (list/delete in Profile). */
export const DRIFTGUIDE_OFFLINE_MAP_PACK_PREFIX = 'driftguide-map-';

/**
 * A download can cover several styles (e.g. terrain + satellite). The first style keeps the base
 * pack name; extra styles get a `-s<index>` suffix so all of a region's packs share the base name
 * and can be listed/deleted together. (rnmapbox serves cached tiles by style+region, not by name,
 * so the names are bookkeeping only.)
 */
export function offlineStylePackName(baseName: string, index: number): string {
  return index === 0 ? baseName : `${baseName}-s${index}`;
}

function isSiblingPackName(name: string, baseName: string): boolean {
  return name === baseName || name.startsWith(`${baseName}-s`);
}

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

/**
 * Delete every pack belonging to a region (the base pack and any `-s<index>` style siblings).
 * Use when removing a downloaded region so multi-style packs don't leave orphaned tiles.
 */
export async function deleteDriftguideOfflinePacksForBase(baseName: string): Promise<void> {
  if (!baseName.startsWith(DRIFTGUIDE_OFFLINE_MAP_PACK_PREFIX)) {
    throw new Error('Invalid offline pack name');
  }
  const om = loadOfflineManager();
  if (!om?.deletePack) {
    throw new Error('Mapbox offline is not available (native build required).');
  }
  let names: string[] = [baseName];
  if (om.getPacks) {
    try {
      const packs = await om.getPacks();
      const found = packs.map(packNameFromNative).filter((n) => isSiblingPackName(n, baseName));
      if (found.length) names = found;
    } catch {
      // fall back to deleting just the base name
    }
  }
  for (const n of names) {
    try {
      await om.deletePack(n);
    } catch (e) {
      console.warn('[mapboxOfflineRegion] deletePack', n, e);
    }
  }
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
  /** Single style to download. Prefer `styleURLs` to cover multiple basemaps in one region. */
  styleURL?: string;
  /** Download a pack per style (e.g. terrain + satellite) so users can switch basemaps offline. */
  styleURLs?: string[];
  minZoom?: number;
  /**
   * Hard ceiling for downloaded zoom. The effective maxZoom is clamped down from here for large
   * areas so a high-res pack can't blow past the tile budget (see resolveOfflineMaxZoom).
   */
  maxZoom?: number;
};

/**
 * Download map tiles for a geographic bbox (same shape as Supabase / cache queries).
 *
 * When multiple styles are requested, one pack is created per style and progress is reported as a
 * combined 0–100 across them.
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
    minZoom = SAMPLE_OFFLINE_MIN_ZOOM,
    maxZoom: hardMaxZoom = SAMPLE_OFFLINE_MAX_ZOOM,
  } = options;
  const styleURLs =
    options.styleURLs && options.styleURLs.length > 0
      ? options.styleURLs
      : [options.styleURL ?? SAMPLE_OFFLINE_STYLE_URL];

  // Clamp the zoom ceiling down for large areas so a z18 pack stays a sane size.
  const maxZoom = resolveOfflineMaxZoom(bbox, minZoom, hardMaxZoom);
  const bounds = mapboxCreatePackBoundsFromBoundingBox(bbox);

  if (name.startsWith(DRIFTGUIDE_OFFLINE_MAP_PACK_PREFIX)) {
    await deleteDriftguideOfflinePacksForBase(name);
  }

  const total = styleURLs.length;
  for (let i = 0; i < total; i++) {
    const packName = offlineStylePackName(name, i);
    await om.createPack(
      {
        name: packName,
        styleURL: styleURLs[i],
        bounds,
        minZoom,
        maxZoom,
      },
      (_pack, status) => {
        const pct = typeof status.percentage === 'number' ? status.percentage : 0;
        onProgress?.({ percentage: (i * 100 + pct) / total });
      },
      (_pack, err) => {
        console.warn('[mapboxOfflineRegion]', err?.message ?? err);
      },
    );
  }
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
