import type { FlyChangeData, Trip, TripEvent, TripEventWithSource } from '@/src/types';

function parseTripEventCoord(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * `trip_events.data` is JSONB; some paths return it as a JSON string. Coerce so UI and totals work.
 */
export function coerceTripEventDataObject(event: TripEvent): Record<string, unknown> {
  const raw = event.data;
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown;
      if (p != null && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return {};
}

export function normalizeTripEventForClient(e: TripEvent): TripEvent {
  const obj = coerceTripEventDataObject(e);
  return {
    ...e,
    data: obj as TripEvent['data'],
    latitude: parseTripEventCoord(e.latitude),
    longitude: parseTripEventCoord(e.longitude),
  };
}

/** Single place for journal / summary timeline row titles (handles stringified `data`). */
export function getTripEventDescription(event: TripEvent): string {
  const d = coerceTripEventDataObject(event);
  switch (event.event_type) {
    case 'catch': {
      const species = typeof d.species === 'string' && d.species.trim() ? d.species.trim() : null;
      const sizeInches = typeof d.size_inches === 'number' ? d.size_inches : null;
      const parts: string[] = [];
      if (species) parts.push(species);
      if (sizeInches != null) parts.push(`${sizeInches}"`);
      const qtyRaw = d.quantity;
      const qty = typeof qtyRaw === 'number' && qtyRaw > 1 ? qtyRaw : 1;
      return parts.length
        ? `Caught ${parts.join(' · ')}${qty > 1 ? ` (×${qty})` : ''}`
        : qty > 1
          ? `${qty} fish caught!`
          : 'Fish caught!';
    }
    case 'fly_change': {
      const pattern = typeof d.pattern === 'string' ? d.pattern.trim() : '';
      const size = typeof d.size === 'number' ? d.size : null;
      const primary = pattern ? `${pattern}${size != null ? ` #${size}` : ''}` : 'Fly';
      const p2 = typeof d.pattern2 === 'string' ? d.pattern2.trim() : '';
      if (p2) {
        const s2 = typeof d.size2 === 'number' ? d.size2 : null;
        return `Changed to ${primary} / ${p2}${s2 != null ? ` #${s2}` : ''}`;
      }
      return `Changed to ${primary}`;
    }
    case 'note': {
      const text = typeof d.text === 'string' ? d.text.trim() : '';
      return text.length > 0 ? text : 'Note';
    }
    case 'ai_query': {
      const q = typeof d.question === 'string' ? d.question.trim() : '';
      return q.length > 0 ? `Asked: ${q}` : 'AI question';
    }
    case 'bite':
      return 'Bite';
    case 'fish_on':
      return 'Fish On';
    case 'got_off':
      return 'Got off';
    case 'location_move':
      return 'Location update';
    case 'ai_response':
      return 'AI response';
    default:
      return 'Event';
  }
}

export function totalFishFromEvents(events: TripEvent[]): number {
  return events
    .filter((e) => e.event_type === 'catch')
    .reduce((sum, e) => {
      const d = coerceTripEventDataObject(e);
      const qty = typeof d.quantity === 'number' && d.quantity >= 1 ? d.quantity : 1;
      return sum + Math.max(1, qty);
    }, 0);
}

export function sortEventsByTime(events: TripEvent[]): TripEvent[] {
  return [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

/** Insert or replace one event and return time-sorted list. */
export function upsertEventSorted(events: TripEvent[], event: TripEvent): TripEvent[] {
  const without = events.filter((e) => e.id !== event.id);
  return sortEventsByTime([...without, event]);
}

export function timestampBetween(
  earlierIso: string | null,
  laterIso: string | null,
  trip: Trip,
): string {
  const end = trip.end_time ? new Date(trip.end_time).getTime() : Date.now();
  const start = new Date(trip.start_time).getTime();
  let lo = earlierIso != null ? new Date(earlierIso).getTime() : start;
  let hi = laterIso != null ? new Date(laterIso).getTime() : end;
  if (Number.isNaN(lo)) lo = start;
  if (Number.isNaN(hi)) hi = end;
  if (hi <= lo) hi = lo + 1000;
  const mid = Math.floor((lo + hi) / 2);
  return new Date(mid).toISOString();
}

/**
 * ISO timestamp strictly after every existing row so each new log entry sorts at the end of the timeline.
 * Photo EXIF belongs in `photos.captured_at` / album metadata — not `trip_events.timestamp` — so old
 * photos do not reorder the live trip log.
 */
export function nextSequentialTimelineTimestamp(trip: Trip, events: TripEvent[]): string {
  const endMs = trip.end_time ? new Date(trip.end_time).getTime() : Date.now();
  const startMs = new Date(trip.start_time).getTime();
  let maxMs = Number.isFinite(startMs) ? startMs : Date.now();
  for (const e of events) {
    const t = new Date(e.timestamp).getTime();
    if (!Number.isNaN(t)) maxMs = Math.max(maxMs, t);
  }
  const candidate = maxMs + 1;
  if (candidate <= endMs) {
    return new Date(candidate).toISOString();
  }
  return new Date(Math.max(maxMs + 1, endMs)).toISOString();
}

/** Last fly_change strictly before `timestampIso` (by sorted order). */
export function findActiveFlyEventIdBefore(events: TripEvent[], timestampIso: string): string | null {
  const t = new Date(timestampIso).getTime();
  let last: string | null = null;
  for (const e of sortEventsByTime(events)) {
    if (new Date(e.timestamp).getTime() >= t) break;
    if (e.event_type === 'fly_change') last = e.id;
  }
  return last;
}

/** Last fly_change by time → rig for `currentFly` / `currentFly2` / `currentFlyEventId` (active trip store). */
export function latestFlyChangeRigFromEvents(events: TripEvent[]): {
  eventId: string | null;
  primary: FlyChangeData | null;
  dropper: FlyChangeData | null;
} {
  let last: TripEvent | null = null;
  for (const e of sortEventsByTime(events)) {
    if (e.event_type === 'fly_change') last = e;
  }
  if (!last) return { eventId: null, primary: null, dropper: null };
  const raw = coerceTripEventDataObject(last);
  const d = raw as unknown as FlyChangeData;
  const primary: FlyChangeData = {
    pattern: typeof d.pattern === 'string' ? d.pattern : '',
    size: d.size,
    color: d.color,
    fly_id: d.fly_id,
    fly_color_id: d.fly_color_id,
    fly_size_id: d.fly_size_id,
  };
  const has2 = d.pattern2 != null && String(d.pattern2).trim().length > 0;
  const dropper: FlyChangeData | null = has2
    ? {
        pattern: d.pattern2!,
        size: d.size2 ?? null,
        color: d.color2 ?? null,
        fly_id: d.fly_id2 ?? undefined,
        fly_color_id: d.fly_color_id2 ?? undefined,
        fly_size_id: d.fly_size_id2 ?? undefined,
      }
    : null;
  return { eventId: last.id, primary, dropper };
}

function isMergedSessionEventRow(e: TripEvent): e is TripEventWithSource {
  return (
    'source_user_id' in e &&
    typeof (e as TripEventWithSource).source_user_id === 'string' &&
    'source_trip_id' in e &&
    typeof (e as TripEventWithSource).source_trip_id === 'string'
  );
}

/** Remove group-merge attribution fields so rows match plain `TripEvent` for storage / edits. */
export function stripTripEventSourceFields(e: TripEvent): TripEvent {
  if (!isMergedSessionEventRow(e)) return e;
  const { source_user_id: _u, source_display_name: _n, source_trip_id: _t, ...rest } = e;
  return rest as TripEvent;
}

/**
 * Solo / child-trip log: keep rows for this `trip_id`. If a row carries group-merge fields (`source_*`),
 * only keep it when it clearly belongs to this viewer’s trip (then strip attribution for editing).
 * Server RLS is the source of truth for ownership; the client must not hide valid local events.
 */
export function filterEventsToViewerTripLog(
  events: TripEvent[],
  tripId: string,
  viewerUserId: string,
): TripEvent[] {
  const out: TripEvent[] = [];
  for (const e of events) {
    if (e.trip_id !== tripId) continue;
    if (isMergedSessionEventRow(e)) {
      if (e.source_user_id !== viewerUserId || e.source_trip_id !== tripId) continue;
      out.push(stripTripEventSourceFields(e));
    } else {
      out.push(e);
    }
  }
  return sortEventsByTime(out);
}
