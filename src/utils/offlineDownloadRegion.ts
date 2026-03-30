import type { BoundingBox, LatLng } from '@/src/types/boundingBox';

/** ~km per degree latitude (WGS84 average). */
const KM_PER_DEG_LAT = 111;

/**
 * Axis-aligned rectangle on the ground: `halfWidthKm` east–west and `halfHeightKm` north–south from center.
 */
export function boundingBoxRectAroundCenter(
  centerLng: number,
  centerLat: number,
  halfWidthKm: number,
  halfHeightKm: number,
): BoundingBox {
  const latRad = (centerLat * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(latRad), 0.01);
  const dLat = halfHeightKm / KM_PER_DEG_LAT;
  const dLng = halfWidthKm / (KM_PER_DEG_LAT * cosLat);
  return {
    ne: { lat: centerLat + dLat, lng: centerLng + dLng },
    sw: { lat: centerLat - dLat, lng: centerLng - dLng },
  };
}

/** Equal half-extents (legacy / symmetric downloads). */
export function boundingBoxSquareAroundCenter(
  centerLng: number,
  centerLat: number,
  halfWidthKm: number,
): BoundingBox {
  return boundingBoxRectAroundCenter(centerLng, centerLat, halfWidthKm, halfWidthKm);
}

/** GeoJSON polygon coordinates for Mapbox ShapeSource (single ring, closed). */
export function boundingBoxToGeoJsonPolygonCoords(bbox: BoundingBox): LatLng[][] {
  const { ne, sw } = bbox;
  const ring: LatLng[] = [
    { lng: sw.lng, lat: sw.lat },
    { lng: ne.lng, lat: sw.lat },
    { lng: ne.lng, lat: ne.lat },
    { lng: sw.lng, lat: ne.lat },
    { lng: sw.lng, lat: sw.lat },
  ];
  return [ring];
}

/**
 * Offline download rectangles: east–west `halfWidthKm`, north–south `halfHeightKm` from center.
 * Mapbox downloads all tiles for the bbox in one `createPack` call; larger preset ≈ more tiles & storage.
 */
export const OFFLINE_REGION_SIZE_PRESETS = {
  small: {
    halfWidthKm: 9,
    halfHeightKm: 16,
    title: 'Small',
    /** Rough full extent (km); varies slightly with latitude. */
    extentLabel: '~18 × 32 km',
    hint: 'Less storage, quicker',
  },
  /** Double each half-extent vs small → ~4× ground area and tile count (same zoom range). */
  large: {
    halfWidthKm: 18,
    halfHeightKm: 32,
    title: 'Large',
    extentLabel: '~36 × 64 km',
    hint: 'More river miles offline',
  },
} as const;

export type OfflineRegionSizePreset = keyof typeof OFFLINE_REGION_SIZE_PRESETS;

export function offlineRegionHalfExtents(preset: OfflineRegionSizePreset): {
  halfWidthKm: number;
  halfHeightKm: number;
} {
  const p = OFFLINE_REGION_SIZE_PRESETS[preset];
  return { halfWidthKm: p.halfWidthKm, halfHeightKm: p.halfHeightKm };
}

/** @deprecated Prefer {@link OFFLINE_REGION_SIZE_PRESETS} / {@link offlineRegionHalfExtents}. */
export const DEFAULT_OFFLINE_REGION_HALF_WIDTH_KM = OFFLINE_REGION_SIZE_PRESETS.small.halfWidthKm;
/** @deprecated Prefer {@link OFFLINE_REGION_SIZE_PRESETS} / {@link offlineRegionHalfExtents}. */
export const DEFAULT_OFFLINE_REGION_HALF_HEIGHT_KM = OFFLINE_REGION_SIZE_PRESETS.small.halfHeightKm;
