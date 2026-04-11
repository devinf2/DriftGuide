import { supabase } from './supabase';
import type { BoundingBox } from '@/src/types/boundingBox';
import type {
  Trip,
  TripEvent,
  EventConditionsSnapshot,
  CatchData,
  FlyChangeData,
  CatchRow,
  CommunityCatchRow,
  TripStatus,
  FishingType,
  SessionType,
  WaterClarity,
} from '@/src/types';
import { normalizeTripEventForClient, totalFishFromEvents } from '@/src/utils/journalTimeline';
import { getCatchHeroPhotoUrl, normalizeCatchPhotoUrls } from '@/src/utils/catchPhotos';

export interface PendingSyncData {
  trips: Trip[];
  events: TripEvent[];
}

function tripToUpsertPayload(trip: Trip, ownerUserId: string) {
  return {
    id: trip.id,
    user_id: ownerUserId,
    location_id: trip.location_id,
    access_point_id: trip.access_point_id ?? null,
    status: trip.status,
    fishing_type: trip.fishing_type,
    planned_date: trip.planned_date,
    start_time: trip.start_time,
    end_time: trip.end_time,
    total_fish: trip.total_fish,
    notes: trip.notes,
    ai_recommendation_cache: trip.ai_recommendation_cache,
    weather_cache: trip.weather_cache,
    water_flow_cache: trip.water_flow_cache,
    start_latitude: trip.start_latitude ?? null,
    start_longitude: trip.start_longitude ?? null,
    end_latitude: trip.end_latitude ?? null,
    end_longitude: trip.end_longitude ?? null,
    session_type: trip.session_type ?? null,
    rating: trip.rating ?? null,
    user_reported_clarity: trip.user_reported_clarity ?? null,
    imported: trip.imported ?? false,
    active_fishing_ms: trip.active_fishing_ms ?? null,
    shared_session_id: trip.shared_session_id ?? null,
    trip_photo_visibility: trip.trip_photo_visibility ?? null,
    survey_submitted_at: trip.survey_submitted_at ?? null,
    last_full_sync_at: trip.last_full_sync_at ?? null,
  };
}

/**
 * RLS uses `is_session_member()` (session_members row OR shared_sessions.created_by).
 * Use the same check via RPC so we never send `shared_session_id` on upsert unless Postgres would allow it.
 */
async function effectiveSharedSessionIdForSync(
  sharedSessionId: string | null | undefined,
  _authUserId: string,
): Promise<string | null> {
  const sid =
    typeof sharedSessionId === 'string' && sharedSessionId.trim().length > 0
      ? sharedSessionId.trim()
      : null;
  if (!sid) return null;

  const { data, error } = await supabase.rpc('is_current_user_session_member', {
    p_session_id: sid,
  });

  if (error) {
    console.warn(
      '[sync] is_current_user_session_member RPC failed; omitting shared_session_id this attempt.',
      error,
    );
    return null;
  }

  if (data !== true) {
    console.warn(
      '[sync] Trip has shared_session_id but DB says user is not in that session; syncing without group link. Re-link from the trip if needed.',
      { sessionId: sid },
    );
    return null;
  }

  return sid;
}

export async function upsertTripToSupabase(trip: Trip): Promise<boolean> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData?.user;
  if (authError || !user) {
    console.error('Error syncing trip: not authenticated', authError);
    return false;
  }

  const payload = tripToUpsertPayload(trip, user.id);
  if (trip.user_id !== user.id) {
    console.warn('Sync: trip.user_id did not match session; using authenticated user id for upsert');
  }

  payload.shared_session_id = await effectiveSharedSessionIdForSync(trip.shared_session_id, user.id);

  let { error } = await supabase.from('trips').upsert(payload);

  if (error?.code === '42501' && payload.shared_session_id) {
    console.warn(
      '[sync] Trip upsert blocked by RLS with shared_session_id; retrying once without it so the trip row can save.',
      { tripId: trip.id, shared_session_id: payload.shared_session_id },
    );
    const retry = { ...payload, shared_session_id: null as string | null };
    const second = await supabase.from('trips').upsert(retry);
    error = second.error;
    if (!error) {
      console.warn(
        '[sync] Trip saved without group link. Open People on the trip and ensure you are in the session, then sync again.',
      );
    }
  }

  if (error) {
    if (error.code === '42501') {
      console.error(
        'Error syncing trip: RLS blocked this upsert. Apply migrations through 060_is_current_user_session_member_rpc (and 057–059). Confirm you own this trip (trip.user_id vs auth) and it is not soft-deleted.',
        {
          tripId: trip.id,
          tripUserId: trip.user_id,
          authUserId: user.id,
          shared_session_id: payload.shared_session_id,
        },
        error,
      );
    } else {
      console.error('Error syncing trip:', error);
    }
    return false;
  }
  return true;
}

export function tripEventToUpsertRow(e: TripEvent) {
  return {
    id: e.id,
    trip_id: e.trip_id,
    event_type: e.event_type,
    timestamp: e.timestamp,
    data: e.data,
    conditions_snapshot: e.conditions_snapshot,
    latitude: e.latitude,
    longitude: e.longitude,
  };
}

/** Upsert one trip_events row (with PGRST204 fallback without conditions_snapshot). */
export async function upsertTripEventsRows(rows: ReturnType<typeof tripEventToUpsertRow>[]): Promise<boolean> {
  let { error: eventsError } = await supabase.from('trip_events').upsert(rows);
  if (eventsError?.code === 'PGRST204') {
    const fallbackRows = rows.map(({ conditions_snapshot, ...rest }) => rest);
    const fallback = await supabase.from('trip_events').upsert(fallbackRows);
    eventsError = fallback.error;
  }
  if (eventsError) {
    console.error('Error syncing events:', eventsError);
    return false;
  }
  return true;
}

export async function syncTripToCloud(trip: Trip, events: TripEvent[]): Promise<boolean> {
  try {
    const tripOk = await upsertTripToSupabase(trip);
    if (!tripOk) return false;

    if (events.length > 0) {
      const rows = events.map(tripEventToUpsertRow);
      const eventsOk = await upsertTripEventsRows(rows);
      if (!eventsOk) return false;

      await syncCatchesAndConditions(trip, events);
    }

    return true;
  } catch (error) {
    console.error('Sync failed:', error);
    return false;
  }
}

/** Build flat row for conditions_snapshots from event snapshot json. */
function conditionsSnapshotToRow(snap: EventConditionsSnapshot | null): Record<string, unknown> | null {
  if (!snap) return null;
  const w = snap.weather;
  const f = snap.waterFlow;
  const capturedAt = snap.captured_at ? new Date(snap.captured_at).toISOString() : new Date().toISOString();
  return {
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
  };
}

/** Resolve fly pattern/size/color for a catch from events (fly_change referenced by active_fly_event_id). */
export function getFlyForCatch(
  catchData: CatchData,
  events: TripEvent[]
): { fly_pattern: string | null; fly_size: number | null; fly_color: string | null } {
  if (!catchData.active_fly_event_id) return { fly_pattern: null, fly_size: null, fly_color: null };
  const flyEvent = events.find(
    (e) => e.id === catchData.active_fly_event_id && e.event_type === 'fly_change'
  );
  if (!flyEvent) return { fly_pattern: null, fly_size: null, fly_color: null };
  const d = flyEvent.data as FlyChangeData;
  const useDropper = catchData.caught_on_fly === 'dropper';
  return {
    fly_pattern: (useDropper && d.pattern2 ? d.pattern2 : d.pattern) ?? null,
    fly_size: (useDropper && d.size2 != null ? d.size2 : d.size) ?? null,
    fly_color: (useDropper && d.color2 ? d.color2 : d.color) ?? null,
  };
}

/** Upsert conditions_snapshots and catches for all catch events; trigger keeps community_catches in sync. */
export async function syncCatchesAndConditions(trip: Trip, events: TripEvent[]): Promise<void> {
  const catchEvents = events.filter((e) => e.event_type === 'catch');
  for (const e of catchEvents) {
    await upsertCatchEventToCloud(trip, e, events);
  }
}

/**
 * Ensures trip row exists, upserts one catch trip_event + catches row (idempotent by event id).
 * Use for immediate map Fish sync and pending-catch flush.
 */
export async function upsertCatchEventToCloud(
  trip: Trip,
  catchEvent: TripEvent,
  allEvents: TripEvent[],
): Promise<boolean> {
  if (catchEvent.event_type !== 'catch') return false;
  try {
    const tripOk = await upsertTripToSupabase(trip);
    if (!tripOk) return false;

    const row = tripEventToUpsertRow(catchEvent);
    const eventsOk = await upsertTripEventsRows([row]);
    if (!eventsOk) return false;

    const snap = catchEvent.conditions_snapshot ?? null;
    const condRow = conditionsSnapshotToRow(snap);
    let conditionsSnapshotId: string | null = null;
    if (condRow) {
      const { data: inserted, error } = await supabase
        .from('conditions_snapshots')
        .insert(condRow)
        .select('id')
        .single();
      if (!error && inserted?.id) {
        conditionsSnapshotId = inserted.id;
      }
    }

    const catchData = catchEvent.data as CatchData;
    const { fly_pattern, fly_size, fly_color } = getFlyForCatch(catchData, allEvents);

    const catchRow = {
      id: catchEvent.id,
      user_id: trip.user_id,
      trip_id: trip.id,
      event_id: catchEvent.id,
      location_id: trip.location_id ?? null,
      access_point_id: trip.access_point_id ?? null,
      latitude: catchEvent.latitude ?? null,
      longitude: catchEvent.longitude ?? null,
      timestamp: catchEvent.timestamp,
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
      photo_url: getCatchHeroPhotoUrl(catchData),
      conditions_snapshot_id: conditionsSnapshotId,
      fly_pattern,
      fly_size,
      fly_color,
    };

    const { error: catchError } = await supabase.from('catches').upsert(catchRow, {
      onConflict: 'id',
    });
    if (catchError) {
      console.error('Error syncing catch', catchEvent.id, catchError);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[upsertCatchEventToCloud]', err);
    return false;
  }
}

/** Catches with coordinates inside the visible bounding box (current user only). */
export async function fetchCatchesInBounds(
  userId: string,
  bbox: BoundingBox,
): Promise<CatchRow[]> {
  try {
    const { data, error } = await supabase
      .from('catches')
      .select('*')
      .eq('user_id', userId)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .gte('latitude', bbox.sw.lat)
      .lte('latitude', bbox.ne.lat)
      .gte('longitude', bbox.sw.lng)
      .lte('longitude', bbox.ne.lng)
      .order('timestamp', { ascending: false });

    if (error) throw error;
    return (data as CatchRow[]) || [];
  } catch (e) {
    console.warn('[fetchCatchesInBounds]', e);
    return [];
  }
}

/** Minimal trip row for offline bundles (RLS: caller only receives own trips). */
export interface OfflineTripSummary {
  id: string;
  status: TripStatus;
  fishing_type: FishingType;
  planned_date: string | null;
  start_time: string | null;
  end_time: string | null;
  session_type: SessionType | null;
  rating: number | null;
  user_reported_clarity: WaterClarity | null;
  notes: string | null;
}

export async function fetchTripSummariesByIds(tripIds: string[]): Promise<Record<string, OfflineTripSummary>> {
  const unique = [...new Set(tripIds.filter(Boolean))];
  if (unique.length === 0) return {};
  try {
    const { data, error } = await supabase
      .from('trips')
      .select(
        'id, status, fishing_type, planned_date, start_time, end_time, session_type, rating, user_reported_clarity, notes',
      )
      .in('id', unique);
    if (error) throw error;
    const map: Record<string, OfflineTripSummary> = {};
    for (const row of data ?? []) {
      const t = row as OfflineTripSummary;
      map[t.id] = t;
    }
    return map;
  } catch (e) {
    console.warn('[fetchTripSummariesByIds]', e);
    return {};
  }
}

/** Community catches with coordinates inside the bbox (offline / map prefetch). */
export async function fetchCommunityCatchesInBounds(
  bbox: BoundingBox,
): Promise<CommunityCatchRow[]> {
  try {
    const { data, error } = await supabase
      .from('community_catches')
      .select('*')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .gte('latitude', bbox.sw.lat)
      .lte('latitude', bbox.ne.lat)
      .gte('longitude', bbox.sw.lng)
      .lte('longitude', bbox.ne.lng)
      .order('timestamp', { ascending: false });

    if (error) throw error;
    return (data as CommunityCatchRow[]) || [];
  } catch (e) {
    console.warn('[fetchCommunityCatchesInBounds]', e);
    return [];
  }
}

/** Single trip if RLS allows (owner or same shared session). */
export async function fetchTripById(tripId: string): Promise<Trip | null> {
  try {
    const { data, error } = await supabase
      .from('trips')
      .select('*, location:locations(*)')
      .eq('id', tripId)
      .maybeSingle();

    if (error) throw error;
    return (data as Trip) ?? null;
  } catch (error) {
    console.error('Error fetching trip by id:', error);
    return null;
  }
}

export async function fetchTripsFromCloud(userId: string): Promise<Trip[]> {
  try {
    const { data, error } = await supabase
      .from('trips')
      .select('*, location:locations(*)')
      .eq('user_id', userId)
      .order('start_time', { ascending: false });

    if (error) throw error;
    return (data as Trip[]) || [];
  } catch (error) {
    console.error('Error fetching trips:', error);
    return [];
  }
}

/**
 * All catches for the user (journal map, fish layer, modals).
 * Merges `catches` with `trip_events` so pins work when coords exist only on the event
 * or the `catches` row was never written but the timeline event was synced.
 */
export async function fetchUserCatchesFromCloud(userId: string): Promise<CatchRow[]> {
  try {
    const { data: catchRows, error: catchesError } = await supabase
      .from('catches')
      .select('*')
      .eq('user_id', userId);

    if (catchesError) throw catchesError;

    const byId = new Map<string, CatchRow>();
    for (const c of (catchRows as CatchRow[]) || []) {
      byId.set(c.id, { ...c });
    }

    const { data: trips, error: tripsError } = await supabase
      .from('trips')
      .select('id, location_id')
      .eq('user_id', userId)
      .eq('status', 'completed');

    if (tripsError) {
      console.warn('[fetchUserCatchesFromCloud] trips', tripsError);
      return Array.from(byId.values()).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    }

    const tripIds = (trips ?? []).map((t) => t.id);
    const tripLocationById = new Map((trips ?? []).map((t) => [t.id, t.location_id] as const));

    if (tripIds.length === 0) {
      return Array.from(byId.values()).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    }

    const { data: events, error: evError } = await supabase
      .from('trip_events')
      .select('id, trip_id, latitude, longitude, timestamp, data')
      .in('trip_id', tripIds)
      .eq('event_type', 'catch');

    if (evError) {
      console.warn('[fetchUserCatchesFromCloud] trip_events', evError);
      return Array.from(byId.values()).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
    }

    for (const ev of events ?? []) {
      const evLat = ev.latitude as number | null | undefined;
      const evLng = ev.longitude as number | null | undefined;
      const hasEvCoords =
        typeof evLat === 'number' &&
        typeof evLng === 'number' &&
        Number.isFinite(evLat) &&
        Number.isFinite(evLng);

      const existing = byId.get(ev.id);
      const data = ev.data as CatchData;

      if (existing) {
        const la = existing.latitude;
        const lo = existing.longitude;
        const needsCoords =
          la == null ||
          lo == null ||
          !Number.isFinite(Number(la)) ||
          !Number.isFinite(Number(lo));
        const urlsFromEvent = normalizeCatchPhotoUrls(data as CatchData);
        const photoPatch =
          urlsFromEvent.length > 0
            ? {
                photo_url: urlsFromEvent[0]!,
                photo_urls: urlsFromEvent,
              }
            : {};
        if (needsCoords && hasEvCoords) {
          byId.set(ev.id, {
            ...existing,
            latitude: evLat!,
            longitude: evLng!,
            ...photoPatch,
          });
        } else if (Object.keys(photoPatch).length > 0) {
          byId.set(ev.id, {
            ...existing,
            ...photoPatch,
          });
        }
        continue;
      }

      if (!hasEvCoords) continue;

      byId.set(ev.id, {
        id: ev.id,
        user_id: userId,
        trip_id: ev.trip_id,
        event_id: ev.id,
        location_id: tripLocationById.get(ev.trip_id) ?? null,
        latitude: evLat!,
        longitude: evLng!,
        timestamp: ev.timestamp,
        species: data?.species ?? null,
        size_inches: data?.size_inches ?? null,
        quantity: Math.max(1, data?.quantity ?? 1),
        released: data?.released ?? null,
        depth_ft: data?.depth_ft ?? null,
        structure: data?.structure ?? null,
        caught_on_fly: data?.caught_on_fly ?? null,
        active_fly_event_id: data?.active_fly_event_id ?? null,
        presentation_method: data?.presentation_method ?? null,
        note: data?.note ?? null,
        photo_url: getCatchHeroPhotoUrl(data as CatchData),
        photo_urls: (() => {
          const u = normalizeCatchPhotoUrls(data as CatchData);
          return u.length > 0 ? u : null;
        })(),
        conditions_snapshot_id: null,
        fly_pattern: null,
        fly_size: null,
        fly_color: null,
      });
    }

    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  } catch (error) {
    console.error('Error fetching catches:', error);
    return [];
  }
}

export async function savePlannedTrip(trip: Trip): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('trips')
      .upsert({
        id: trip.id,
        user_id: trip.user_id,
        location_id: trip.location_id,
        access_point_id: trip.access_point_id ?? null,
        status: 'planned',
        fishing_type: trip.fishing_type,
        planned_date: trip.planned_date,
        start_time: trip.start_time,
        end_time: null,
        total_fish: 0,
        notes: trip.notes,
        ai_recommendation_cache: null,
        weather_cache: null,
        water_flow_cache: trip.water_flow_cache ?? null,
        start_latitude: null,
        start_longitude: null,
        end_latitude: null,
        end_longitude: null,
        session_type: trip.session_type ?? null,
        rating: null,
        user_reported_clarity: null,
        imported: false,
      });

    if (error) {
      console.error('Error saving planned trip:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Save planned trip failed:', error);
    return false;
  }
}

export async function fetchPlannedTripsFromCloud(userId: string): Promise<Trip[]> {
  try {
    const { data, error } = await supabase
      .from('trips')
      .select('*, location:locations(*)')
      .eq('user_id', userId)
      .eq('status', 'planned')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data as Trip[]) || [];
  } catch (error) {
    console.error('Error fetching planned trips:', error);
    return [];
  }
}

export async function deleteTripFromCloud(tripId: string): Promise<boolean> {
  try {
    // Remove photos linked to this trip from storage + photos table
    const { data: photos } = await supabase
      .from('photos')
      .select('id, url')
      .eq('trip_id', tripId);

    if (photos && photos.length > 0) {
      const storagePaths = photos
        .map((p: { url: string }) => {
          try {
            const u = new URL(p.url);
            const match = u.pathname.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)/);
            return match ? match[1] : null;
          } catch { return null; }
        })
        .filter(Boolean) as string[];

      if (storagePaths.length > 0) {
        await supabase.storage.from('photos').remove(storagePaths).catch(() => {});
      }

      await supabase
        .from('photos')
        .delete()
        .eq('trip_id', tripId);
    }

    const { error: eventsError } = await supabase
      .from('trip_events')
      .delete()
      .eq('trip_id', tripId);

    if (eventsError) {
      console.error('Error deleting trip events:', eventsError);
      return false;
    }

    const { error } = await supabase
      .from('trips')
      .delete()
      .eq('id', tripId);

    if (error) {
      console.error('Error deleting trip:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Delete trip failed:', error);
    return false;
  }
}

/** When `trip_events` rows lack GPS, copy from `catches` (same id) so edit UI and maps stay consistent. */
async function mergeCatchCoordsFromCatchesTable(events: TripEvent[]): Promise<TripEvent[]> {
  const needIds = events
    .filter((e) => {
      if (e.event_type !== 'catch') return false;
      const la = e.latitude != null ? Number(e.latitude) : NaN;
      const lo = e.longitude != null ? Number(e.longitude) : NaN;
      return !Number.isFinite(la) || !Number.isFinite(lo);
    })
    .map((e) => e.id);
  if (needIds.length === 0) return events;

  const { data: rows, error } = await supabase
    .from('catches')
    .select('id, latitude, longitude')
    .in('id', needIds);

  if (error || !rows?.length) return events;

  const coordById = new Map<string, { la: number; lo: number }>();
  for (const r of rows as { id: string; latitude: number | null; longitude: number | null }[]) {
    const la = r.latitude != null ? Number(r.latitude) : NaN;
    const lo = r.longitude != null ? Number(r.longitude) : NaN;
    if (Number.isFinite(la) && Number.isFinite(lo)) {
      coordById.set(r.id, { la, lo });
    }
  }
  if (coordById.size === 0) return events;

  return events.map((ev) => {
    if (ev.event_type !== 'catch') return ev;
    const curLa = ev.latitude != null ? Number(ev.latitude) : NaN;
    const curLo = ev.longitude != null ? Number(ev.longitude) : NaN;
    if (Number.isFinite(curLa) && Number.isFinite(curLo)) return ev;
    const c = coordById.get(ev.id);
    if (!c) return ev;
    return { ...ev, latitude: c.la, longitude: c.lo };
  });
}

/** When `trip_events.data` has no photo URLs, copy hero URL from `catches` (session peers + group timeline). */
async function mergeCatchPhotosFromCatchesTable(events: TripEvent[]): Promise<TripEvent[]> {
  const needIds = events
    .filter((e) => e.event_type === 'catch')
    .filter((e) => normalizeCatchPhotoUrls(e.data as CatchData).length === 0)
    .map((e) => e.id);
  if (needIds.length === 0) return events;

  const { data: rows, error } = await supabase
    .from('catches')
    .select('id, photo_url')
    .in('id', needIds);

  if (error || !rows?.length) return events;

  const urlById = new Map<string, string>();
  for (const r of rows as { id: string; photo_url: string | null }[]) {
    const u = r.photo_url?.trim();
    if (u) urlById.set(r.id, u);
  }
  if (urlById.size === 0) return events;

  return events.map((ev) => {
    if (ev.event_type !== 'catch') return ev;
    if (normalizeCatchPhotoUrls(ev.data as CatchData).length > 0) return ev;
    const u = urlById.get(ev.id);
    if (!u) return ev;
    const d = ev.data as CatchData;
    return {
      ...ev,
      data: {
        ...d,
        photo_url: u,
        photo_urls: [u],
      },
    };
  });
}

export async function fetchTripEvents(tripId: string): Promise<TripEvent[]> {
  try {
    const { data, error } = await supabase
      .from('trip_events')
      .select('*')
      .eq('trip_id', tripId)
      .order('timestamp', { ascending: true });

    if (error) throw error;
    const raw = (data as TripEvent[]) || [];
    const events = raw.map(normalizeTripEventForClient);
    const withCoords = await mergeCatchCoordsFromCatchesTable(events);
    return mergeCatchPhotosFromCatchesTable(withCoords);
  } catch (error) {
    console.error('Error fetching events:', error);
    return [];
  }
}

/** Persist one timeline row. Catch events also upsert `catches` (+ conditions snapshot). */
export async function upsertJournalTripEvent(
  trip: Trip,
  event: TripEvent,
  allEvents: TripEvent[],
): Promise<boolean> {
  if (event.event_type === 'catch') {
    return upsertCatchEventToCloud(trip, event, allEvents);
  }
  return upsertTripEventsRows([tripEventToUpsertRow(event)]);
}

export async function deleteJournalTripEvent(tripId: string, eventId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('trip_events')
      .delete()
      .eq('id', eventId)
      .eq('trip_id', tripId);
    if (error) {
      console.error('Error deleting trip event:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[deleteJournalTripEvent]', e);
    return false;
  }
}

/** Updates `trips.total_fish` from catch event quantities (journal edits). */
export async function updateTripTotalFishInCloud(trip: Trip, events: TripEvent[]): Promise<boolean> {
  const total_fish = totalFishFromEvents(events);
  if (trip.total_fish === total_fish) return true;
  return upsertTripToSupabase({ ...trip, total_fish });
}
