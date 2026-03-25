import { supabase } from './supabase';
import type { BoundingBox } from '@/src/types/boundingBox';
import type {
  Trip,
  TripEvent,
  EventConditionsSnapshot,
  CatchData,
  FlyChangeData,
  CatchRow,
} from '@/src/types';
import { totalFishFromEvents } from '@/src/utils/journalTimeline';

export interface PendingSyncData {
  trips: Trip[];
  events: TripEvent[];
}

function tripToUpsertPayload(trip: Trip) {
  return {
    id: trip.id,
    user_id: trip.user_id,
    location_id: trip.location_id,
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
  };
}

async function upsertTripToSupabase(trip: Trip): Promise<boolean> {
  const { error } = await supabase.from('trips').upsert(tripToUpsertPayload(trip));
  if (error) {
    console.error('Error syncing trip:', error);
    return false;
  }
  return true;
}

function tripEventToUpsertRow(e: TripEvent) {
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
async function upsertTripEventsRows(rows: ReturnType<typeof tripEventToUpsertRow>[]): Promise<boolean> {
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
async function syncCatchesAndConditions(trip: Trip, events: TripEvent[]): Promise<void> {
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
      photo_url: catchData.photo_url ?? null,
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
        if (needsCoords && hasEvCoords) {
          byId.set(ev.id, {
            ...existing,
            latitude: evLat!,
            longitude: evLng!,
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
        photo_url: data?.photo_url ?? null,
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

export async function fetchTripEvents(tripId: string): Promise<TripEvent[]> {
  try {
    const { data, error } = await supabase
      .from('trip_events')
      .select('*')
      .eq('trip_id', tripId)
      .order('timestamp', { ascending: true });

    if (error) throw error;
    return (data as TripEvent[]) || [];
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
