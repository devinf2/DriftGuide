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
export const SAMPLE_OFFLINE_MAX_ZOOM = 16;

export const SAMPLE_OFFLINE_STYLE_URL = MAPBOX_STYLE_URL;
