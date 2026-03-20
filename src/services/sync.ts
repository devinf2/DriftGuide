import { supabase } from './supabase';
import type {
  Trip,
  TripEvent,
  EventConditionsSnapshot,
  CatchData,
  FlyChangeData,
} from '@/src/types';

export interface PendingSyncData {
  trips: Trip[];
  events: TripEvent[];
}

export async function syncTripToCloud(trip: Trip, events: TripEvent[]): Promise<boolean> {
  try {
    const { error: tripError } = await supabase
      .from('trips')
      .upsert({
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
      });

    if (tripError) {
      console.error('Error syncing trip:', tripError);
      return false;
    }

    if (events.length > 0) {
      const rows = events.map(e => ({
        id: e.id,
        trip_id: e.trip_id,
        event_type: e.event_type,
        timestamp: e.timestamp,
        data: e.data,
        conditions_snapshot: e.conditions_snapshot,
        latitude: e.latitude,
        longitude: e.longitude,
      }));

      let { error: eventsError } = await supabase
        .from('trip_events')
        .upsert(rows);

      if (eventsError?.code === 'PGRST204') {
        const fallbackRows = rows.map(({ conditions_snapshot, ...rest }) => rest);
        const fallback = await supabase.from('trip_events').upsert(fallbackRows);
        eventsError = fallback.error;
      }

      if (eventsError) {
        console.error('Error syncing events:', eventsError);
        return false;
      }

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
function getFlyForCatch(
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
  if (catchEvents.length === 0) return;

  for (const e of catchEvents) {
    const snap = e.conditions_snapshot ?? null;
    const row = conditionsSnapshotToRow(snap);
    let conditionsSnapshotId: string | null = null;
    if (row) {
      const { data: inserted, error } = await supabase
        .from('conditions_snapshots')
        .insert(row)
        .select('id')
        .single();
      if (!error && inserted?.id) {
        conditionsSnapshotId = inserted.id;
      }
    }

    const catchData = e.data as CatchData;
    const { fly_pattern, fly_size, fly_color } = getFlyForCatch(catchData, events);

    const catchRow = {
      id: e.id,
      user_id: trip.user_id,
      trip_id: trip.id,
      event_id: e.id,
      location_id: trip.location_id ?? null,
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
      console.error('Error syncing catch', e.id, catchError);
    }
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
