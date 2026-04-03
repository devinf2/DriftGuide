import type { CatchDetailsSubmitAdd } from '@/src/components/catch/CatchDetailsModal';
import type { FlyChangeData } from '@/src/types';
import type { ImportPhoto, ImportTripGroup } from '@/src/stores/importPastTripsStore';
import { parseISO } from 'date-fns';

/** Placeholder fly so timeline / sync have a linked fly_change; user can edit later. */
const MINIMAL_PRIMARY_FLY: FlyChangeData = {
  pattern: 'Other',
  size: null,
  color: null,
  fly_id: null,
  fly_color_id: null,
  fly_size_id: null,
};

export function orderPhotoIdsByTripOrder(group: ImportTripGroup, photoIds: string[]): string[] {
  const set = new Set(photoIds);
  return group.photoIds.filter((id) => set.has(id));
}

/**
 * Catch with photos only (no species/size/note). Timestamp from earliest EXIF in set, else trip date noon.
 */
export function buildMinimalCatchPayloadForImport(
  group: ImportTripGroup,
  photos: ImportPhoto[],
  photoIds: string[],
): CatchDetailsSubmitAdd {
  const ordered = orderPhotoIdsByTripOrder(group, photoIds);
  const uris = ordered.map((id) => photos.find((p) => p.id === id)?.uri).filter(Boolean) as string[];
  const taken = ordered
    .map((id) => photos.find((p) => p.id === id)?.meta?.takenAt)
    .filter((t): t is Date => t != null && !Number.isNaN(t.getTime()));
  const key = group.tripDateKey;
  const baseFromKey =
    key && key !== '__unknown__' ? parseISO(`${key}T12:00:00`) : new Date();
  const baseDay = Number.isNaN(baseFromKey.getTime()) ? new Date() : baseFromKey;
  const captured =
    taken.length > 0 ? new Date(Math.min(...taken.map((t) => t.getTime()))) : baseDay;
  const iso = captured.toISOString();

  const loc = group.location;
  const lat = loc?.latitude != null && Number.isFinite(loc.latitude) ? loc.latitude : null;
  const lon = loc?.longitude != null && Number.isFinite(loc.longitude) ? loc.longitude : null;

  return {
    primary: { ...MINIMAL_PRIMARY_FLY },
    dropper: null,
    catchFields: { quantity: 1 },
    latitude: lat,
    longitude: lon,
    photoUris: uris,
    photoCapturedAtIso: iso,
    catchTimestampIso: iso,
    conditionsSnapshot: undefined,
  };
}
