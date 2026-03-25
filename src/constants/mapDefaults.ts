/**
 * Default map center when GPS is unavailable (Salt Lake City area).
 * Coordinates as [longitude, latitude] for Mapbox.
 */
export const DEFAULT_MAP_CENTER: [number, number] = [-111.891, 40.76];

/** Regional overview when GPS is unknown */
export const DEFAULT_MAP_ZOOM = 8.5;

/** Closer framing when centering on the user or a new catch */
export const USER_LOCATION_ZOOM = 12;

/** Pinch / +/- zoom limits */
export const MAP_MIN_ZOOM = 3;
export const MAP_MAX_ZOOM = 18;
