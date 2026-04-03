import { addPhoto, PhotoQueuedOfflineError } from '@/src/services/photoService';
import { syncTripToCloud } from '@/src/services/sync';
import type { CatchData, FishingType, Location, Trip, TripEvent } from '@/src/types';
import { normalizeCatchPhotoUrls } from '@/src/utils/catchPhotos';
import type { ImportPhoto, ImportTripGroup } from '@/src/stores/importPastTripsStore';
import { sortEventsByTime, totalFishFromEvents } from '@/src/utils/journalTimeline';
import { parseISO } from 'date-fns';

function isRemoteStorageUrl(uri: string): boolean {
  const t = uri.trim();
  return t.startsWith('http://') || t.startsWith('https://');
}

export function buildCompletedTripForImport(
  group: ImportTripGroup,
  photos: ImportPhoto[],
  userId: string,
  fishingType: FishingType,
): Trip {
  const times = group.photoIds
    .map((id) => photos.find((p) => p.id === id)?.meta.takenAt)
    .filter((t): t is Date => t != null);
  const baseDay = parseISO(`${group.tripDateKey}T12:00:00`);
  const start =
    times.length > 0
      ? new Date(Math.min(...times.map((t) => t.getTime()))).toISOString()
      : baseDay.toISOString();
  const end =
    times.length > 0
      ? new Date(Math.max(...times.map((t) => t.getTime()))).toISOString()
      : new Date(baseDay.getTime() + 3600000).toISOString();

  const loc: Location | undefined = group.location ?? undefined;
  const lat = loc?.latitude ?? null;
  const lng = loc?.longitude ?? null;

  return {
    id: group.draftTripId,
    user_id: userId,
    location_id: group.locationId,
    access_point_id: null,
    location: loc,
    status: 'completed',
    fishing_type: fishingType,
    planned_date: null,
    start_time: start,
    end_time: end,
    total_fish: totalFishFromEvents(group.events),
    notes: null,
    ai_recommendation_cache: null,
    weather_cache: group.weatherCache,
    water_flow_cache: null,
    start_latitude: lat,
    start_longitude: lng,
    end_latitude: lat,
    end_longitude: lng,
    session_type: 'wade',
    rating: null,
    user_reported_clarity: null,
    imported: true,
    created_at: new Date().toISOString(),
  };
}

/** Strip local file URIs from catch rows for first sync (catches table expects URLs or null). */
function eventsWithCatchPhotosNulled(events: TripEvent[]): TripEvent[] {
  return events.map((e) => {
    if (e.event_type !== 'catch') return e;
    const d = e.data as CatchData;
    return {
      ...e,
      data: {
        ...d,
        photo_url: null,
        photo_urls: null,
      } as CatchData,
    };
  });
}

export type FinalizeImportResult = { ok: true } | { ok: false; message: string };

/**
 * Upload catch photos, scenery photos, then sync trip + events with remote URLs on catches.
 */
export async function finalizeImportGroup(
  group: ImportTripGroup,
  photos: ImportPhoto[],
  userId: string,
  fishingType: FishingType,
  isOnline: boolean,
): Promise<FinalizeImportResult> {
  const trip = buildCompletedTripForImport(group, photos, userId, fishingType);
  const sorted = sortEventsByTime([...group.events]);

  const stripped = eventsWithCatchPhotosNulled(sorted);
  let ok = await syncTripToCloud(trip, stripped);
  if (!ok) return { ok: false, message: 'Could not save trip. Check your connection and try again.' };

  const rebuilt: TripEvent[] = [];
  for (const e of sorted) {
    if (e.event_type !== 'catch') {
      rebuilt.push(e);
      continue;
    }
    const d = e.data as CatchData;
    const urls = normalizeCatchPhotoUrls(d);
    const remote: string[] = [];
    for (let i = 0; i < urls.length; i++) {
      const uri = urls[i];
      if (isRemoteStorageUrl(uri)) {
        remote.push(uri);
        continue;
      }
      try {
        const row = await addPhoto(
          {
            userId,
            tripId: trip.id,
            uri,
            catchId: e.id,
            displayOrder: i,
            captured_at:
              photos.find((p) => p.uri === uri)?.meta.takenAt?.toISOString() ?? e.timestamp,
          },
          { isOnline },
        );
        remote.push(row.url);
      } catch (err) {
        if (err instanceof PhotoQueuedOfflineError) {
          return { ok: false, message: 'Photo upload was queued offline. Go online to finish import.' };
        }
        return { ok: false, message: (err as Error).message };
      }
    }
    rebuilt.push({
      ...e,
      data: {
        ...d,
        photo_url: remote[0] ?? null,
        photo_urls: remote.length ? remote : null,
      } as CatchData,
    });
  }

  ok = await syncTripToCloud(trip, rebuilt);
  if (!ok) return { ok: false, message: 'Trip saved but updating catch photos failed.' };

  for (const pid of group.photoIds) {
    const st = group.photoStates[pid];
    if (st.kind !== 'scenery') continue;
    const ph = photos.find((p) => p.id === pid);
    if (!ph) continue;
    try {
      await addPhoto(
        {
          userId,
          tripId: trip.id,
          uri: ph.uri,
          captured_at: ph.meta.takenAt?.toISOString() ?? undefined,
        },
        { isOnline },
      );
    } catch (err) {
      if (err instanceof PhotoQueuedOfflineError) {
        return { ok: false, message: 'A scenery photo was queued offline. Go online to finish import.' };
      }
      return { ok: false, message: (err as Error).message };
    }
  }

  return { ok: true };
}
