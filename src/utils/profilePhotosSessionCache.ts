import type { PhotoWithTrip } from '@/src/services/photoService';

/** In-memory; survives leaving Profile until app reload. Keyed by album owner (you or a friend’s peer id). */
const sessionProfilePhotosByOwnerId = new Map<string, PhotoWithTrip[]>();

/** `undefined` = not loaded this session; `[]` = loaded, empty library */
export function getSessionProfilePhotos(ownerId: string): PhotoWithTrip[] | undefined {
  return sessionProfilePhotosByOwnerId.get(ownerId);
}

export function setSessionProfilePhotos(ownerId: string, photos: PhotoWithTrip[]): void {
  sessionProfilePhotosByOwnerId.set(ownerId, photos);
}
