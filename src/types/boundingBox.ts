/**
 * Canonical axis-aligned bounding box for map viewport queries, offline tile regions,
 * Supabase/PostGIS filters, and local cache. Corners are WGS84; not specialized for
 * antimeridian wraps (fine for CONUS-scale use).
 */
export type LatLng = { lat: number; lng: number };

export type BoundingBox = {
  ne: LatLng;
  sw: LatLng;
};

/**
 * Mapbox `getVisibleBounds()` returns two [lng, lat] corners; order is not guaranteed.
 */
export function boundingBoxFromLngLatPair(
  a: [number, number],
  b: [number, number],
): BoundingBox {
  const lngs = [a[0], b[0]];
  const lats = [a[1], b[1]];
  return {
    ne: { lat: Math.max(...lats), lng: Math.max(...lngs) },
    sw: { lat: Math.min(...lats), lng: Math.min(...lngs) },
  };
}

/** `offlineManager.createPack` expects [[neLng, neLat], [swLng, swLat]]. */
export function mapboxCreatePackBoundsFromBoundingBox(
  bbox: BoundingBox,
): [[number, number], [number, number]] {
  return [
    [bbox.ne.lng, bbox.ne.lat],
    [bbox.sw.lng, bbox.sw.lat],
  ];
}

export function isPointInBoundingBox(lat: number, lng: number, bbox: BoundingBox): boolean {
  return (
    lat <= bbox.ne.lat &&
    lat >= bbox.sw.lat &&
    lng <= bbox.ne.lng &&
    lng >= bbox.sw.lng
  );
}
