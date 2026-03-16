import { supabase } from './supabase';
import { Trip, TripEvent } from '@/src/types';

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
    }

    return true;
  } catch (error) {
    console.error('Sync failed:', error);
    return false;
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
