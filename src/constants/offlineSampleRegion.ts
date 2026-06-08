import { MAPBOX_STYLE_URL } from '@/src/constants/mapbox';
import {
  mapboxCreatePackBoundsFromBoundingBox,
  type BoundingBox,
} from '@/src/types/boundingBox';

export const SAMPLE_OFFLINE_PACK_NAME = 'driftguide-sample-utah-valley';

/** Provo / Utah Valley–ish sample region (canonical `BoundingBox`). */
export const SAMPLE_OFFLINE_BOUNDING_BOX: BoundingBox = {
  ne: { lat: 40.45, lng: -111.45 },
  sw: { lat: 40.05, lng: -111.85 },
};

/** Mapbox `createPack` bounds derived from {@link SAMPLE_OFFLINE_BOUNDING_BOX}. */
export const SAMPLE_OFFLINE_BOUNDS = mapboxCreatePackBoundsFromBoundingBox(
  SAMPLE_OFFLINE_BOUNDING_BOX,
);

export const SAMPLE_OFFLINE_MIN_ZOOM = 10;
/**
 * Match the interactive map's `MAP_MAX_ZOOM` (18). Downloading only to z16 (the old value)
 * left zooms 17–18 with no tiles, so Mapbox upscaled z16 tiles → the grainy/blurry look.
 * Each extra zoom level ~4× the tiles, so areas are capped (see OFFLINE_REGION_SIZE_PRESETS
 * and resolveOfflineMaxZoom) to keep z18 packs a reasonable size.
 */
export const SAMPLE_OFFLINE_MAX_ZOOM = 18;

export const SAMPLE_OFFLINE_STYLE_URL = MAPBOX_STYLE_URL;
