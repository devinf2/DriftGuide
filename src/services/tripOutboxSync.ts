import type { Trip, TripEvent } from '@/src/types';
import type { EventSyncStatus } from '@/src/types/sync';
import {
  getPendingPhotos,
  removePendingPhoto,
  updatePendingTripEventPhotoUrl,
  type PendingPhoto,
} from '@/src/services/pendingPhotoStorage';
import { patchPendingTripPayload, type PendingTripPayload } from '@/src/services/pendingSyncStorage';
import { addPhoto } from '@/src/services/photoService';
import {
  syncTripToCloud,
  syncCatchesAndConditions,
  tripEventToUpsertRow,
  upsertTripEventsRows,
  upsertTripToSupabase,
} from '@/src/services/sync';
import { useTripStore } from '@/src/stores/tripStore';
import { deleteSandboxPendingPhotoFile } from '@/src/services/persistentPhotoUri';

let outboxChain: Promise<void> = Promise.resolve();

export function runTripOutboxExclusive(fn: () => Promise<void>): Promise<void> {
  const next = outboxChain.then(() => fn());
  outboxChain = next.then(() => {}).catch(() => {});
  return next;
}

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

/** Upload pending album rows for one trip only (ordered). */
export async function processPendingPhotosForTripId(tripId: string): Promise<void> {
  const list = await getPendingPhotos();
  const mine = list.filter((p) => p.tripId === tripId);
  if (mine.length === 0) return;

  const resolveCatchEventPhotoUpload = useTripStore.getState().resolveCatchEventPhotoUpload;

  const sorted = [...mine].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
  });

  for (const p of sorted) {
    try {
      const photo = await addPhoto(pendingToAddPhotoOptions(p), { isOnline: true });
      const url = photo.url;

      if (p.type === 'catch' && p.eventId) {
        resolveCatchEventPhotoUpload(p.tripId, p.eventId, p.uri, url);
        await updatePendingTripEventPhotoUrl(p.tripId, p.eventId, url);
      }

      await removePendingPhoto(p.id);
      await deleteSandboxPendingPhotoFile(p.uri);
    } catch (e) {
      console.warn('[processPendingPhotosForTripId] failed for', p.id, e);
    }
  }
}

function allEventsSyncedState(events: TripEvent[], status: EventSyncStatus): Record<string, EventSyncStatus> {
  const m: Record<string, EventSyncStatus> = {};
  for (const e of events) m[e.id] = status;
  return m;
}

/**
 * Push one pending trip bundle: photos for trip → trip/events/catches → optional deferred survey last.
 */
export async function syncPendingTripBundle(payload: PendingTripPayload): Promise<boolean> {
  const { trip, events, surveyPendingCloud, deferredSurvey, tripNotesPreSurvey } = payload;

  await patchPendingTripPayload(trip.id, {
    eventSyncState: allEventsSyncedState(events, 'syncing'),
  });

  try {
    await processPendingPhotosForTripId(trip.id);
  } catch (e) {
    console.warn('[syncPendingTripBundle] processPendingPhotosForTripId', e);
  }

  if (surveyPendingCloud && deferredSurvey) {
    const tripBase: Trip = {
      ...trip,
      rating: null,
      user_reported_clarity: null,
      notes: tripNotesPreSurvey ?? null,
      survey_submitted_at: null,
      last_full_sync_at: null,
    };

    if (!(await upsertTripToSupabase(tripBase))) {
      await patchPendingTripPayload(trip.id, {
        eventSyncState: allEventsSyncedState(events, 'error'),
      });
      return false;
    }

    if (events.length > 0) {
      const rows = events.map(tripEventToUpsertRow);
      if (!(await upsertTripEventsRows(rows))) {
        await patchPendingTripPayload(trip.id, {
          eventSyncState: allEventsSyncedState(events, 'error'),
        });
        return false;
      }
      await syncCatchesAndConditions(trip, events);
    }

    const stamp = new Date().toISOString();
    const tripFinal: Trip = {
      ...trip,
      rating: deferredSurvey.rating,
      user_reported_clarity: deferredSurvey.user_reported_clarity,
      notes: deferredSurvey.notes,
      last_full_sync_at: stamp,
      survey_submitted_at:
        deferredSurvey.rating != null ? (trip.survey_submitted_at ?? stamp) : trip.survey_submitted_at ?? null,
    };

    const surveyOk = await upsertTripToSupabase(tripFinal);
    if (!surveyOk) {
      await patchPendingTripPayload(trip.id, {
        eventSyncState: allEventsSyncedState(events, 'error'),
      });
      return false;
    }

    await patchPendingTripPayload(trip.id, {
      eventSyncState: allEventsSyncedState(events, 'synced'),
      surveyPendingCloud: false,
      deferredSurvey: undefined,
      tripNotesPreSurvey: undefined,
    });
    return true;
  }

  const stamp = new Date().toISOString();
  const stampedTrip: Trip = {
    ...trip,
    last_full_sync_at: stamp,
    ...(trip.rating != null ? { survey_submitted_at: trip.survey_submitted_at ?? stamp } : {}),
  };
  const ok = await syncTripToCloud(stampedTrip, events);
  if (ok) {
    await patchPendingTripPayload(trip.id, {
      eventSyncState: allEventsSyncedState(events, 'synced'),
    });
  } else {
    await patchPendingTripPayload(trip.id, {
      eventSyncState: allEventsSyncedState(events, 'error'),
    });
  }
  return ok;
}
