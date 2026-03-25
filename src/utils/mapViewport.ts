import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  USER_LOCATION_ZOOM,
} from '@/src/constants/mapDefaults';
import {
  boundingBoxFromLngLatPair,
  type BoundingBox,
} from '@/src/types/boundingBox';
import type { Trip } from '@/src/types';

export type { BoundingBox };

/** Subset of @rnmapbox/maps MapState (avoids static import from native module). */
export type MapCameraStatePayload = {
  properties: {
    bounds: {
      ne: [number, number];
      sw: [number, number];
    };
    zoom: number;
    center: [number, number];
  };
};

/**
 * Mapbox camera payload: bounds.ne/sw are [lng, lat].
 * Prefer ref.getVisibleRegion() for data queries; this is useful for UI-only reactions.
 */
export function boundingBoxFromMapState(state: MapCameraStatePayload): BoundingBox {
  const { ne, sw } = state.properties.bounds;
  return boundingBoxFromLngLatPair(ne, sw);
}

/** Mapbox camera center [lng, lat]: trip GPS start, else saved location, else regional default. */
export function tripMapDefaultCenterCoordinate(trip: Trip): [number, number] {
  if (trip.start_latitude != null && trip.start_longitude != null) {
    return [trip.start_longitude, trip.start_latitude];
  }
  const lat = trip.location?.latitude;
  const lng = trip.location?.longitude;
  if (lat != null && lng != null) return [lng, lat];
  return DEFAULT_MAP_CENTER;
}

export function tripMapDefaultZoom(trip: Trip): number {
  if (trip.start_latitude != null && trip.start_longitude != null) return USER_LOCATION_ZOOM;
  const lat = trip.location?.latitude;
  const lng = trip.location?.longitude;
  if (lat != null && lng != null) return USER_LOCATION_ZOOM;
  return DEFAULT_MAP_ZOOM;
}

/**
 * Journal map: most recent trip start (or location), else first geotagged catch, else default region.
 */
export function journalMapDefaultFraming(
  trips: Trip[],
  fallbackPins: { latitude: number | null; longitude: number | null }[],
): { center: [number, number]; zoom: number } {
  const sorted = [...trips].sort(
    (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
  );
  for (const t of sorted) {
    if (t.start_latitude != null && t.start_longitude != null) {
      return { center: [t.start_longitude, t.start_latitude], zoom: USER_LOCATION_ZOOM };
    }
    const lat = t.location?.latitude;
    const lng = t.location?.longitude;
    if (lat != null && lng != null) {
      return { center: [lng, lat], zoom: USER_LOCATION_ZOOM };
    }
  }
  for (const c of fallbackPins) {
    if (c.latitude != null && c.longitude != null) {
      return { center: [c.longitude, c.latitude], zoom: USER_LOCATION_ZOOM };
    }
  }
  return { center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM };
}
