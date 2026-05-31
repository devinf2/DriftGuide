import type { CatchData, FlyChangeData, Trip, TripEvent, TripEventWithSource } from '@/src/types';
import { v4 as uuidv4 } from 'uuid';

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

/** Human-readable weight from lb + oz (0–15); null if unset or zero. */
export function formatCatchWeightLabel(
  lb: number | null | undefined,
  oz: number | null | undefined,
): string | null {
  const li = lb != null && Number.isFinite(Number(lb)) ? Math.max(0, Math.floor(Number(lb))) : null;
  const oi = oz != null && Number.isFinite(Number(oz)) ? Math.max(0, Math.min(15, Math.floor(Number(oz)))) : null;
  if (li == null && oi == null) return null;
  const l = li ?? 0;
  const o = oi ?? 0;
  if (l === 0 && o === 0) return null;
  if (l > 0 && o > 0) return `${l} lb ${o} oz`;
  if (l > 0) return `${l} lb`;
  return `${o} oz`;
}

function formatCatchDetailLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function appendCatchMeasurementDetailLines(data: CatchData, lines: string[]): void {
  const w = formatCatchWeightLabel(data.weight_lb, data.weight_oz);
  if (w) lines.push(`Weight: ${w}`);
  if (data.depth_ft != null) lines.push(`Depth: ${data.depth_ft} ft`);
  if (data.structure) lines.push(`Structure: ${formatCatchDetailLabel(data.structure)}`);
  if (data.presentation_method) lines.push(`Presentation: ${formatCatchDetailLabel(data.presentation_method)}`);
  if (data.released != null) lines.push(`Released: ${data.released ? 'Yes' : 'No'}`);
}

/** Species label for viewers — includes length when set. */
export function formatCatchSpeciesLabel(data: CatchData): string | null {
  const species = data.species?.trim();
  if (species && data.size_inches != null) return `${data.size_inches}" ${species}`;
  if (species) return species;
  if (data.size_inches != null) return `${data.size_inches}"`;
  return null;
}

/** Extra catch detail lines shown when a timeline row is expanded (excludes species/size subtitle). */
export function getCatchDetailLines(data: CatchData): string[] {
  const lines: string[] = [];
  if (data.note?.trim()) lines.push(data.note.trim());
  appendCatchMeasurementDetailLines(data, lines);
  return lines;
}

/** Weight, depth, structure, presentation, released — for photo viewer (note is shown separately). */
export function getCatchViewerDetailLines(data: CatchData): string[] {
  const lines: string[] = [];
  appendCatchMeasurementDetailLines(data, lines);
  return lines;
}

/** Single place for journal / summary timeline row titles (handles stringified `data`). */
export function getTripEventDescription(event: TripEvent): string {
  const d = coerceTripEventDataObject(event);
  switch (event.event_type) {
    case 'catch': {
      const species = typeof d.species === 'string' && d.species.trim() ? d.species.trim() : null;
      const sizeInches = typeof d.size_inches === 'number' ? d.size_inches : null;
      const wlb = typeof d.weight_lb === 'number' ? d.weight_lb : null;
      const woz = typeof d.weight_oz === 'number' ? d.weight_oz : null;
      const wLabel = formatCatchWeightLabel(wlb, woz);
      const parts: string[] = [];
      if (species) parts.push(species);
      if (sizeInches != null) parts.push(`${sizeInches}"`);
      if (wLabel) parts.push(wLabel);
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

export type TimelineFlySlot = 'primary' | 'secondary';

export type TimelineDisplayRow = {
  key: string;
  event: TripEvent;
  flySlot: TimelineFlySlot | null;
  /** Index in `sortEventsByTime(events)` for row menu / insert actions */
  eventIndex: number;
};

function flyChangeDataHasSecondary(data: FlyChangeData): boolean {
  return data.pattern2 != null && String(data.pattern2).trim().length > 0;
}

/** One timeline row label for a single rig slot on a fly_change event. */
export function getFlyChangeSlotDescription(data: FlyChangeData, slot: TimelineFlySlot): string {
  if (slot === 'secondary') {
    const pattern = typeof data.pattern2 === 'string' ? data.pattern2.trim() : '';
    const label = pattern || 'Fly';
    return `Changed to ${label}`;
  }
  const pattern = typeof data.pattern === 'string' ? data.pattern.trim() : '';
  const label = pattern || 'Fly';
  return `Changed to ${label}`;
}

export function getFlyChangeTimelineDescription(event: TripEvent, slot: TimelineFlySlot): string {
  const d = coerceTripEventDataObject(event) as unknown as FlyChangeData;
  return getFlyChangeSlotDescription(d, slot);
}

/**
 * Expand combined fly_change rows into separate primary / secondary timeline entries.
 * Within one fly_change event, primary is always listed before secondary.
 */
export function buildTimelineDisplayRows(
  events: TripEvent[],
  options?: { newestFirst?: boolean },
): TimelineDisplayRow[] {
  const sorted = sortEventsByTime(events);
  const orderedEvents = options?.newestFirst ? [...sorted].reverse() : sorted;
  const rows: TimelineDisplayRow[] = [];

  for (let displayIdx = 0; displayIdx < orderedEvents.length; displayIdx++) {
    const event = orderedEvents[displayIdx];
    const eventIndex = options?.newestFirst ? sorted.length - 1 - displayIdx : displayIdx;

    if (event.event_type === 'fly_change') {
      const d = coerceTripEventDataObject(event) as unknown as FlyChangeData;
      rows.push({
        key: `${event.id}-primary`,
        event,
        flySlot: 'primary',
        eventIndex,
      });
      if (flyChangeDataHasSecondary(d)) {
        rows.push({
          key: `${event.id}-secondary`,
          event,
          flySlot: 'secondary',
          eventIndex,
        });
      }
      continue;
    }

    rows.push({
      key: event.id,
      event,
      flySlot: null,
      eventIndex,
    });
  }

  return rows;
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

/** Empty catch row for timeline insert / append (opens CatchDetailsModal for details). */
export function createBlankCatchEvent(
  tripId: string,
  timestamp: string,
  events: TripEvent[],
  eventId: string = uuidv4(),
): TripEvent {
  return {
    id: eventId,
    trip_id: tripId,
    event_type: 'catch',
    timestamp,
    data: {
      species: null,
      size_inches: null,
      weight_lb: null,
      weight_oz: null,
      note: null,
      photo_url: null,
      active_fly_event_id: findActiveFlyEventIdBefore(events, timestamp),
      caught_on_fly: null,
      quantity: 1,
      depth_ft: null,
      presentation_method: null,
      released: null,
      structure: null,
    } as CatchData,
    conditions_snapshot: null,
    latitude: null,
    longitude: null,
  };
}

export function appendBlankCatchEventAtTimelineEnd(trip: Trip, events: TripEvent[]): TripEvent {
  return createBlankCatchEvent(trip.id, nextSequentialTimelineTimestamp(trip, events), events);
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
    user_fly_box_id: d.user_fly_box_id,
    photo_url: d.photo_url,
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
        user_fly_box_id: d.user_fly_box_id2 ?? undefined,
        photo_url: d.photo_url2 ?? undefined,
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
