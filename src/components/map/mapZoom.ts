import type { Region } from 'react-native-maps';

export const MAP_ZOOM_MIN_DELTA = 0.0015;
export const MAP_ZOOM_MAX_DELTA = 50;

export function clampMapDelta(d: number): number {
  return Math.min(MAP_ZOOM_MAX_DELTA, Math.max(MAP_ZOOM_MIN_DELTA, d));
}

/** `zoomIn` true = tighter view (smaller deltas). */
export function zoomMapRegion(region: Region, zoomIn: boolean): Region {
  const factor = zoomIn ? 0.62 : 1 / 0.62;
  return {
    ...region,
    latitudeDelta: clampMapDelta(region.latitudeDelta * factor),
    longitudeDelta: clampMapDelta(region.longitudeDelta * factor),
  };
}
