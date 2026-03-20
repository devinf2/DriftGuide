import { addPhoto } from './photoService';
import {
  getPendingPhotos,
  removePendingPhoto,
  updatePendingTripEventPhotoUrl,
  type PendingPhoto,
} from './pendingPhotoStorage';
import { useTripStore } from '@/src/stores/tripStore';

function pendingToAddPhotoOptions(p: PendingPhoto): Parameters<typeof addPhoto>[0] {
  return {
    userId: p.userId,
    tripId: p.tripId,
    uri: p.uri,
    caption: p.caption ?? undefined,
    species: p.species ?? undefined,
    fly_pattern: p.fly_pattern ?? undefined,
    fly_size: p.fly_size ?? undefined,
    fly_color: p.fly_color ?? undefined,
    fly_id: p.fly_id ?? undefined,
    captured_at: p.captured_at ?? undefined,
  };
}

export async function processPendingPhotos(): Promise<void> {
  const list = await getPendingPhotos();
  if (list.length === 0) return;

  const updateEventPhotoUrl = useTripStore.getState().updateEventPhotoUrl;

  for (const p of list) {
    try {
      const options = pendingToAddPhotoOptions(p);
      const photo = await addPhoto(options);
      const url = photo.url;

      if (p.type === 'catch' && p.eventId) {
        updateEventPhotoUrl(p.tripId, p.eventId, url);
        await updatePendingTripEventPhotoUrl(p.tripId, p.eventId, url);
      }

      await removePendingPhoto(p.id);
    } catch (e) {
      console.warn('[processPendingPhotos] failed for', p.id, e);
      // leave in queue to retry later
    }
  }
}
