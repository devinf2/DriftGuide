import { addPhoto } from './photoService';
import {
  getPendingPhotos,
  removePendingPhoto,
  updatePendingTripEventPhotoUrl,
  type PendingPhoto,
} from './pendingPhotoStorage';
import { deleteSandboxPendingPhotoFile } from './persistentPhotoUri';
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
    catchId: p.type === 'catch' ? p.eventId : undefined,
    displayOrder: p.displayOrder ?? 0,
  };
}

export async function processPendingPhotos(): Promise<void> {
  const list = await getPendingPhotos();
  if (list.length === 0) return;

  const resolveCatchEventPhotoUpload = useTripStore.getState().resolveCatchEventPhotoUpload;

  const sorted = [...list].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
  });

  for (const p of sorted) {
    try {
      const options = pendingToAddPhotoOptions(p);
      const photo = await addPhoto(options, { skipEnqueueOnFailure: true });
      const url = photo.url;

      if (p.type === 'catch' && p.eventId) {
        resolveCatchEventPhotoUpload(p.tripId, p.eventId, p.uri, url);
        await updatePendingTripEventPhotoUrl(p.tripId, p.eventId, url);
      }

      await removePendingPhoto(p.id);
      await deleteSandboxPendingPhotoFile(p.uri);
    } catch (e) {
      console.warn('[processPendingPhotos] failed for', p.id, e);
      // leave in queue to retry later
    }
  }
}
