import type { BoundingBox } from '@/src/types/boundingBox';

/**
 * Web-Mercator (XYZ) tile math for sizing offline downloads.
 *
 * `createPack` downloads every tile in the bbox for each integer zoom from minZoom..maxZoom,
 * and each zoom level holds ~4× the tiles of the one below it. Raising maxZoom sharpens the
 * map but multiplies storage fast, so we estimate the tile count up front and clamp maxZoom
 * for any bbox large enough to blow past a budget.
 */

function lngToTileX(lng: number, z: number): number {
  const n = 2 ** z;
  return ((lng + 180) / 360) * n;
}

function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
}

/** Tile count covering `bbox` at a single integer zoom level. */
export function tileCountAtZoom(bbox: BoundingBox, z: number): number {
  const x0 = Math.floor(lngToTileX(bbox.sw.lng, z));
  const x1 = Math.floor(lngToTileX(bbox.ne.lng, z));
  // y grows southward, so the NE (north) corner is the smaller y.
  const y0 = Math.floor(latToTileY(bbox.ne.lat, z));
  const y1 = Math.floor(latToTileY(bbox.sw.lat, z));
  return (Math.abs(x1 - x0) + 1) * (Math.abs(y1 - y0) + 1);
}

/** Total tiles across the inclusive zoom range, for one map style. */
export function estimateOfflineTileCount(
  bbox: BoundingBox,
  minZoom: number,
  maxZoom: number,
): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    total += tileCountAtZoom(bbox, z);
  }
  return total;
}

/**
 * Soft budget (tiles per style) used to clamp maxZoom for oversized areas. The size presets
 * are tuned to stay under this at z18; this only bites for ad-hoc / unexpectedly large bboxes.
 */
export const MAX_OFFLINE_TILES_PER_STYLE = 12000;

/**
 * Highest zoom in [minZoom, hardMaxZoom] whose estimated tile count stays within `budget`.
 * Small areas keep the full hardMaxZoom (sharp); only large areas step down.
 */
export function resolveOfflineMaxZoom(
  bbox: BoundingBox,
  minZoom: number,
  hardMaxZoom: number,
  budget: number = MAX_OFFLINE_TILES_PER_STYLE,
): number {
  for (let z = hardMaxZoom; z > minZoom; z--) {
    if (estimateOfflineTileCount(bbox, minZoom, z) <= budget) return z;
  }
  return minZoom;
}
