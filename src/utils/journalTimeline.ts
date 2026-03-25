import type { CatchData, FlyChangeData, Trip, TripEvent } from '@/src/types';

export function totalFishFromEvents(events: TripEvent[]): number {
  return events
    .filter((e) => e.event_type === 'catch')
    .reduce((sum, e) => {
      const d = e.data as CatchData;
      return sum + Math.max(1, d.quantity ?? 1);
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
  const d = last.data as FlyChangeData;
  const primary: FlyChangeData = {
    pattern: d.pattern,
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
