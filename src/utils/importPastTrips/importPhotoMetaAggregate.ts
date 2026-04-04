import type { ImportPhoto } from '@/src/stores/importPastTripsStore';
import type { PhotoExifMetadata } from '@/src/utils/imageExif';

/**
 * Earliest capture time and mean GPS among the given import photos (trip order preserved).
 * Used for catch pins, location search anchor, and seeding the catch details modal.
 */
export function aggregateImportPhotoMeta(
  photos: ImportPhoto[],
  photoIds: string[],
): PhotoExifMetadata {
  const ordered = photoIds
    .map((id) => photos.find((p) => p.id === id))
    .filter((p): p is ImportPhoto => p != null);
  const taken = ordered
    .map((p) => p.meta.takenAt)
    .filter((t): t is Date => t != null && !Number.isNaN(t.getTime()));
  const takenAt =
    taken.length > 0 ? new Date(Math.min(...taken.map((t) => t.getTime()))) : null;

  const withGps = ordered.filter(
    (p) =>
      p.meta.latitude != null &&
      p.meta.longitude != null &&
      Number.isFinite(p.meta.latitude) &&
      Number.isFinite(p.meta.longitude),
  );
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (withGps.length > 0) {
    latitude = withGps.reduce((s, p) => s + p.meta.latitude!, 0) / withGps.length;
    longitude = withGps.reduce((s, p) => s + p.meta.longitude!, 0) / withGps.length;
  }
  return { takenAt, latitude, longitude };
}
