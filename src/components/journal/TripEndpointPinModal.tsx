import { findTripEndedEvent, findTripStartedEvent } from '@/src/utils/tripStartEndFromEvents';
import type { Trip, TripEvent } from '@/src/types';

export type TripEndpointKind = 'start' | 'end';

export function patchTripEndpointCoords(
  trip: Trip,
  events: TripEvent[],
  kind: TripEndpointKind,
  lat: number,
  lng: number,
): { trip: Trip; events: TripEvent[] } {
  const nextTrip: Trip =
    kind === 'start'
      ? { ...trip, start_latitude: lat, start_longitude: lng }
      : { ...trip, end_latitude: lat, end_longitude: lng };

  if (kind === 'start') {
    const ev = findTripStartedEvent(events);
    if (!ev) return { trip: nextTrip, events };
    return {
      trip: nextTrip,
      events: events.map((e) => (e.id === ev.id ? { ...e, latitude: lat, longitude: lng } : e)),
    };
  }

  const ev = findTripEndedEvent(events);
  if (!ev) return { trip: nextTrip, events };
  return {
    trip: nextTrip,
    events: events.map((e) => (e.id === ev.id ? { ...e, latitude: lat, longitude: lng } : e)),
  };
}

/** Seed coords when opening start/end pin placement on the trip map. */
export function getTripEndpointInitialCoords(
  trip: Trip,
  kind: TripEndpointKind,
): { lat: number | null; lon: number | null } {
  if (kind === 'start') {
    const la = trip.start_latitude ?? null;
    const lo = trip.start_longitude ?? null;
    if (la != null && lo != null) return { lat: la, lon: lo };
  } else {
    const la = trip.end_latitude ?? null;
    const lo = trip.end_longitude ?? null;
    if (la != null && lo != null) return { lat: la, lon: lo };
  }
  const loc = trip.location;
  if (loc?.latitude != null && loc?.longitude != null) {
    return { lat: loc.latitude, lon: loc.longitude };
  }
  return { lat: null, lon: null };
}
