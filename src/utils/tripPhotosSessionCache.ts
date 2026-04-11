import type { Photo } from '@/src/types';

/** In-memory only; survives screen unmount until app reload. Keyed by user + trip. */
const sessionTripPhotosByKey = new Map<string, Photo[]>();

function cacheKey(userId: string, tripId: string): string {
  return `${userId}:${tripId}`;
}

function logCache(...args: unknown[]) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[TripPhotosCache]', ...args);
  }
}

/** For debugging cache misses (e.g. userId/tripId key mismatch). */
export function getTripPhotosCacheDebugKeys(): string[] {
  return [...sessionTripPhotosByKey.keys()];
}

/** `undefined` = not loaded this session yet; `[]` = loaded, zero photos */
export function getSessionTripPhotos(userId: string, tripId: string): Photo[] | undefined {
  return sessionTripPhotosByKey.get(cacheKey(userId, tripId));
}

export function setSessionTripPhotos(userId: string, tripId: string, photos: Photo[]): void {
  const key = cacheKey(userId, tripId);
  sessionTripPhotosByKey.set(key, photos);
  logCache('set', key, `${photos.length} rows`, `mapSize=${sessionTripPhotosByKey.size}`);
}
