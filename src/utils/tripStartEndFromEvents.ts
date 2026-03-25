import { sortEventsByTime } from '@/src/utils/journalTimeline';
import type { NoteData, Trip, TripEvent } from '@/src/types';

export function findTripStartedEvent(events: TripEvent[]): TripEvent | null {
  const sorted = sortEventsByTime(events);
  for (const e of sorted) {
    if (e.event_type !== 'note') continue;
    const t = (e.data as NoteData).text;
    if (t === 'Trip started') return e;
  }
  return null;
}

export function findTripEndedEvent(events: TripEvent[]): TripEvent | null {
  const sorted = sortEventsByTime(events);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    if (e.event_type !== 'note') continue;
    const t = (e.data as NoteData).text;
    if (typeof t === 'string' && t.startsWith('Trip ended')) return e;
  }
  return null;
}

/** Prefer `trips` columns; fall back to start/end note events (older rows may lack trip GPS). */
export function tripStartEndDisplayCoords(
  trip: Trip,
  events: TripEvent[],
): {
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
} {
  const startEv = findTripStartedEvent(events);
  const endEv = findTripEndedEvent(events);
  return {
    startLat: trip.start_latitude ?? startEv?.latitude ?? null,
    startLon: trip.start_longitude ?? startEv?.longitude ?? null,
    endLat: trip.end_latitude ?? endEv?.latitude ?? null,
    endLon: trip.end_longitude ?? endEv?.longitude ?? null,
  };
}
