import { v4 as uuidv4 } from 'uuid';
import { addPhoto, PhotoQueuedOfflineError, uploadPhotoToStorage } from '@/src/services/photoService';
import { fetchHistoricalWeather } from '@/src/services/historicalWeather';
import { supabase } from '@/src/services/supabase';
import { syncTripToCloud, getFlyForCatch } from '@/src/services/sync';
import type { CatchData, EventConditionsSnapshot, FishingType, Location, Trip, TripEvent } from '@/src/types';
import { normalizeCatchPhotoUrls, getCatchHeroPhotoUrl } from '@/src/utils/catchPhotos';
import type { ImportPhoto, ImportTripGroup } from '@/src/stores/importPastTripsStore';
import { aggregateImportPhotoMeta } from '@/src/utils/importPastTrips/importPhotoMetaAggregate';
import { sortEventsByTime, totalFishFromEvents } from '@/src/utils/journalTimeline';
import { enrichCatchEventsWithHistoricalConditions } from '@/src/utils/importPastTrips/enrichImportConditions';
import { parseISO } from 'date-fns';

/** Same instant heuristic as per-catch historical enrichment: earliest EXIF in trip, else trip-date noon. */
function weatherAnchorDateForImportGroup(group: ImportTripGroup, photos: ImportPhoto[]): Date {
  const times = group.photoIds
    .map((id) => photos.find((p) => p.id === id)?.meta.takenAt)
    .filter((t): t is Date => t != null);
  if (times.length > 0) {
    return new Date(Math.min(...times.map((t) => t.getTime())));
  }
  const key = group.tripDateKey;
  const baseFromKey =
    key && key !== '__unknown__' ? parseISO(`${key}T12:00:00`) : new Date();
  return Number.isNaN(baseFromKey.getTime()) ? new Date() : baseFromKey;
}

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
  const tripPhotoMeta = aggregateImportPhotoMeta(photos, group.photoIds);
  const latFromLoc = loc?.latitude ?? null;
  const lngFromLoc = loc?.longitude ?? null;
  const latOk = latFromLoc != null && Number.isFinite(latFromLoc);
  const lngOk = lngFromLoc != null && Number.isFinite(lngFromLoc);
  const lat =
    latOk && lngOk
      ? latFromLoc
      : tripPhotoMeta.latitude != null && tripPhotoMeta.longitude != null
        ? tripPhotoMeta.latitude
        : latFromLoc;
  const lng =
    latOk && lngOk
      ? lngFromLoc
      : tripPhotoMeta.latitude != null && tripPhotoMeta.longitude != null
        ? tripPhotoMeta.longitude
        : lngFromLoc;

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
  let trip = buildCompletedTripForImport(group, photos, userId, fishingType);
  if (!trip.weather_cache && isOnline && group.location) {
    const la = group.location.latitude;
    const lo = group.location.longitude;
    if (la != null && lo != null && Number.isFinite(la) && Number.isFinite(lo)) {
      const at = weatherAnchorDateForImportGroup(group, photos);
      if (!Number.isNaN(at.getTime())) {
        try {
          const w = await fetchHistoricalWeather(la, lo, at);
          if (w) trip = { ...trip, weather_cache: w };
        } catch {
          /* keep null */
        }
      }
    }
  }

  const sorted = sortEventsByTime([...group.events]);
  const enriched = await enrichCatchEventsWithHistoricalConditions(sorted, {
    fallbackLat: group.location?.latitude,
    fallbackLon: group.location?.longitude,
    isOnline,
  });

  const stripped = eventsWithCatchPhotosNulled(enriched);
  let ok = await syncTripToCloud(trip, stripped);
  if (!ok) return { ok: false, message: 'Could not save trip. Check your connection and try again.' };

  const rebuilt: TripEvent[] = [];
  for (const e of enriched) {
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

// ---------------------------------------------------------------------------
// Batch import: parallel photo uploads + single RPC
// ---------------------------------------------------------------------------

const UPLOAD_CONCURRENCY = 5;

/** Run async tasks with a concurrency cap. */
async function pooled<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

interface PhotoUploadJob {
  localUri: string;
  userId: string;
}

/** Flat conditions-snapshot row for the RPC with a pre-generated UUID. */
function conditionsSnapshotToRpcRow(
  snap: EventConditionsSnapshot | null,
): { row: Record<string, unknown>; id: string } | null {
  if (!snap) return null;
  const w = snap.weather;
  const f = snap.waterFlow;
  const capturedAt = snap.captured_at
    ? new Date(snap.captured_at).toISOString()
    : new Date().toISOString();
  const id = uuidv4();
  return {
    id,
    row: {
      id,
      temperature_f: w?.temperature_f ?? null,
      condition: w?.condition ?? null,
      cloud_cover: w?.cloud_cover ?? null,
      wind_speed_mph: w?.wind_speed_mph ?? null,
      wind_direction: w?.wind_direction ?? null,
      barometric_pressure: w?.barometric_pressure ?? null,
      humidity: w?.humidity ?? null,
      flow_station_id: f?.station_id ?? null,
      flow_station_name: f?.station_name ?? null,
      flow_cfs: f?.flow_cfs ?? null,
      water_temp_f: f?.water_temp_f ?? null,
      gage_height_ft: f?.gage_height_ft ?? null,
      turbidity_ntu: f?.turbidity_ntu ?? null,
      flow_clarity: f?.clarity ?? null,
      flow_clarity_source: f?.clarity_source ?? null,
      flow_timestamp: f?.timestamp ?? null,
      moon_phase: snap.moon_phase ?? null,
      captured_at: capturedAt,
    },
  };
}

/**
 * Batch-import all groups in one shot:
 *  1. Enrich weather (parallelized per group)
 *  2. Upload all photos in parallel (concurrency-capped)
 *  3. Build payloads for trips, events, conditions, catches, photos
 *  4. Single RPC call to batch_import_trips
 */
export async function batchFinalizeImport(
  groups: ImportTripGroup[],
  photos: ImportPhoto[],
  userId: string,
  fishingType: FishingType,
  isOnline: boolean,
): Promise<FinalizeImportResult> {
  if (!isOnline) {
    return { ok: false, message: 'You must be online to import trips.' };
  }

  // -- Phase 1: Build trips & enrich events (weather) in parallel per group --
  type EnrichedGroup = {
    group: ImportTripGroup;
    trip: Trip;
    events: TripEvent[];
  };

  const enrichedGroups: EnrichedGroup[] = await Promise.all(
    groups.map(async (group) => {
      let trip = buildCompletedTripForImport(group, photos, userId, fishingType);

      if (!trip.weather_cache && group.location) {
        const la = group.location.latitude;
        const lo = group.location.longitude;
        if (la != null && lo != null && Number.isFinite(la) && Number.isFinite(lo)) {
          const at = weatherAnchorDateForImportGroup(group, photos);
          if (!Number.isNaN(at.getTime())) {
            try {
              const w = await fetchHistoricalWeather(la, lo, at);
              if (w) trip = { ...trip, weather_cache: w };
            } catch {
              /* keep null */
            }
          }
        }
      }

      const sorted = sortEventsByTime([...group.events]);
      const enriched = await enrichCatchEventsWithHistoricalConditions(sorted, {
        fallbackLat: group.location?.latitude,
        fallbackLon: group.location?.longitude,
        isOnline,
      });

      return { group, trip, events: enriched };
    }),
  );

  // -- Phase 2: Collect every local photo URI and upload in parallel --
  const uploadJobs: { key: string; job: PhotoUploadJob }[] = [];
  const uriUrlMap = new Map<string, string>();

  for (const { group, events } of enrichedGroups) {
    for (const e of events) {
      if (e.event_type !== 'catch') continue;
      const d = e.data as CatchData;
      const urls = normalizeCatchPhotoUrls(d);
      for (const uri of urls) {
        if (isRemoteStorageUrl(uri)) {
          uriUrlMap.set(uri, uri);
        } else if (!uriUrlMap.has(uri)) {
          uriUrlMap.set(uri, '');
          uploadJobs.push({ key: uri, job: { localUri: uri, userId } });
        }
      }
    }
    for (const pid of group.photoIds) {
      const st = group.photoStates[pid];
      if (st.kind !== 'scenery') continue;
      const ph = photos.find((p) => p.id === pid);
      if (!ph) continue;
      if (!isRemoteStorageUrl(ph.uri) && !uriUrlMap.has(ph.uri)) {
        uriUrlMap.set(ph.uri, '');
        uploadJobs.push({ key: ph.uri, job: { localUri: ph.uri, userId } });
      }
    }
  }

  const uploadTasks = uploadJobs.map(({ key, job }) => async () => {
    const { url } = await uploadPhotoToStorage(job.userId, job.localUri);
    uriUrlMap.set(key, url);
    return url;
  });

  try {
    await pooled(uploadTasks, UPLOAD_CONCURRENCY);
  } catch (err) {
    return { ok: false, message: `Photo upload failed: ${(err as Error).message}` };
  }

  // -- Phase 3: Build RPC payloads --
  const rpcTrips: Record<string, unknown>[] = [];
  const rpcEvents: Record<string, unknown>[] = [];
  const rpcConditions: Record<string, unknown>[] = [];
  const rpcCatches: Record<string, unknown>[] = [];
  const rpcPhotos: Record<string, unknown>[] = [];

  for (const { group, trip, events } of enrichedGroups) {
    rpcTrips.push({
      id: trip.id,
      user_id: trip.user_id,
      location_id: trip.location_id,
      access_point_id: trip.access_point_id ?? null,
      status: trip.status,
      fishing_type: trip.fishing_type,
      planned_date: trip.planned_date,
      start_time: trip.start_time,
      end_time: trip.end_time,
      total_fish: trip.total_fish,
      notes: trip.notes,
      ai_recommendation_cache: trip.ai_recommendation_cache ?? {},
      weather_cache: trip.weather_cache ?? {},
      water_flow_cache: trip.water_flow_cache ?? {},
      start_latitude: trip.start_latitude ?? null,
      start_longitude: trip.start_longitude ?? null,
      end_latitude: trip.end_latitude ?? null,
      end_longitude: trip.end_longitude ?? null,
      session_type: trip.session_type ?? null,
      rating: trip.rating ?? null,
      user_reported_clarity: trip.user_reported_clarity ?? null,
      imported: true,
    });

    // Patch catch event data with remote URLs before serializing events
    const patchedEvents = events.map((e) => {
      if (e.event_type !== 'catch') return e;
      const d = e.data as CatchData;
      const localUrls = normalizeCatchPhotoUrls(d);
      const remoteUrls = localUrls.map((u) => uriUrlMap.get(u) || u);
      return {
        ...e,
        data: {
          ...d,
          photo_url: remoteUrls[0] ?? null,
          photo_urls: remoteUrls.length ? remoteUrls : null,
        } as CatchData,
      };
    });

    for (const e of patchedEvents) {
      rpcEvents.push({
        id: e.id,
        trip_id: e.trip_id,
        event_type: e.event_type,
        timestamp: e.timestamp,
        data: e.data,
        conditions_snapshot: e.conditions_snapshot ?? null,
        latitude: e.latitude ?? null,
        longitude: e.longitude ?? null,
      });

      if (e.event_type === 'catch') {
        const catchData = e.data as CatchData;
        const { fly_pattern, fly_size, fly_color } = getFlyForCatch(catchData, patchedEvents);

        const condResult = conditionsSnapshotToRpcRow(e.conditions_snapshot ?? null);
        if (condResult) rpcConditions.push(condResult.row);

        rpcCatches.push({
          id: e.id,
          user_id: userId,
          trip_id: trip.id,
          event_id: e.id,
          location_id: trip.location_id ?? null,
          access_point_id: trip.access_point_id ?? null,
          latitude: e.latitude ?? null,
          longitude: e.longitude ?? null,
          timestamp: e.timestamp,
          species: catchData.species ?? null,
          size_inches: catchData.size_inches ?? null,
          quantity: Math.max(1, catchData.quantity ?? 1),
          released: catchData.released ?? null,
          depth_ft: catchData.depth_ft ?? null,
          structure: catchData.structure ?? null,
          caught_on_fly: catchData.caught_on_fly ?? null,
          active_fly_event_id: catchData.active_fly_event_id ?? null,
          presentation_method: catchData.presentation_method ?? null,
          note: catchData.note ?? null,
          photo_url: getCatchHeroPhotoUrl({
            ...catchData,
            photo_url: (e.data as CatchData).photo_url,
            photo_urls: (e.data as CatchData).photo_urls,
          } as CatchData),
          conditions_snapshot_id: condResult?.id ?? null,
          fly_pattern,
          fly_size,
          fly_color,
        });

        // Photo table rows for catch photos
        const remoteUrls = normalizeCatchPhotoUrls(e.data as CatchData);
        for (let i = 0; i < remoteUrls.length; i++) {
          const url = remoteUrls[i];
          if (!url) continue;
          const matchedPhoto = photos.find((p) => uriUrlMap.get(p.uri) === url || p.uri === url);
          rpcPhotos.push({
            user_id: userId,
            trip_id: trip.id,
            url,
            catch_id: e.id,
            display_order: i,
            caption: null,
            species: catchData.species ?? null,
            fly_pattern: fly_pattern ?? null,
            fly_size: fly_size != null ? String(fly_size) : null,
            fly_color: fly_color ?? null,
            captured_at: matchedPhoto?.meta.takenAt?.toISOString() ?? e.timestamp,
          });
        }
      }
    }

    // Photo table rows for scenery photos
    for (const pid of group.photoIds) {
      const st = group.photoStates[pid];
      if (st.kind !== 'scenery') continue;
      const ph = photos.find((p) => p.id === pid);
      if (!ph) continue;
      const url = uriUrlMap.get(ph.uri) || ph.uri;
      rpcPhotos.push({
        user_id: userId,
        trip_id: trip.id,
        url,
        catch_id: null,
        display_order: 0,
        caption: null,
        species: null,
        fly_pattern: null,
        fly_size: null,
        fly_color: null,
        captured_at: ph.meta.takenAt?.toISOString() ?? null,
      });
    }
  }

  // -- Phase 4: Single RPC call --
  const { error } = await supabase.rpc('batch_import_trips', {
    p_trips: rpcTrips,
    p_events: rpcEvents,
    p_conditions: rpcConditions,
    p_catches: rpcCatches,
    p_photos: rpcPhotos,
  });

  if (error) {
    console.error('[batchFinalizeImport] RPC failed:', error);
    return { ok: false, message: `Import failed: ${error.message}` };
  }

  return { ok: true };
}
