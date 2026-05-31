import type { CatchData, Fly, FlyCatalog, FlyChangeData, TripEvent } from '@/src/types';
import { coerceTripEventDataObject } from '@/src/utils/journalTimeline';
import { displayFlyName } from '@/src/utils/flyValidation';
import { resolveFlyPhotoUrlFromChangeData } from '@/src/utils/resolveFlyPhotoUrl';

export type TripFlyWithPhoto = {
  key: string;
  pattern: string;
  size: number | null;
  color: string | null;
  photoUrl: string | null;
  userFlyBoxId: string | null;
  catalogFlyId: string | null;
  catchCount: number;
};

export function formatFlySizeColorDetail(size: number | null, color: string | null): string | null {
  const parts: string[] = [];
  if (size != null) parts.push(`#${size}`);
  if (color?.trim()) parts.push(color.trim());
  return parts.length ? parts.join(' · ') : null;
}

function slotFromChangeData(data: FlyChangeData, slot: 'primary' | 'dropper'): TripFlyWithPhoto | null {
  const pattern = slot === 'primary' ? data.pattern : data.pattern2 ?? '';
  if (!pattern.trim()) return null;
  const size = slot === 'primary' ? data.size ?? null : data.size2 ?? null;
  const color = slot === 'primary' ? data.color ?? null : data.color2 ?? null;
  const userFlyBoxId =
    slot === 'primary' ? data.user_fly_box_id ?? null : data.user_fly_box_id2 ?? null;
  const catalogFlyId = slot === 'primary' ? data.fly_id ?? null : data.fly_id2 ?? null;
  const key = userFlyBoxId ?? `${pattern}|${size ?? ''}|${color ?? ''}|${catalogFlyId ?? ''}`;
  return {
    key,
    pattern: displayFlyName(pattern),
    size,
    color,
    photoUrl: null,
    userFlyBoxId,
    catalogFlyId,
    catchCount: 0,
  };
}

function catchFlyKeyFromEvent(
  catchEvent: TripEvent,
  flyChangeById: Map<string, TripEvent>,
): string | null {
  const data = coerceTripEventDataObject(catchEvent) as unknown as CatchData;
  if (!data.active_fly_event_id) return null;
  const flyEv = flyChangeById.get(data.active_fly_event_id);
  if (!flyEv) return null;
  const fd = coerceTripEventDataObject(flyEv) as unknown as FlyChangeData;
  const slot: 'primary' | 'dropper' =
    data.caught_on_fly === 'dropper' && fd.pattern2?.trim() ? 'dropper' : 'primary';
  return slotFromChangeData(fd, slot)?.key ?? null;
}

function countCatchesByFlyKey(events: TripEvent[]): Map<string, number> {
  const flyChangeById = new Map<string, TripEvent>();
  for (const event of events) {
    if (event.event_type === 'fly_change') flyChangeById.set(event.id, event);
  }

  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.event_type !== 'catch') continue;
    const key = catchFlyKeyFromEvent(event, flyChangeById);
    if (!key) continue;
    const data = coerceTripEventDataObject(event) as unknown as CatchData;
    const qty = Math.max(1, data.quantity ?? 1);
    counts.set(key, (counts.get(key) ?? 0) + qty);
  }
  return counts;
}

export function getTripFliesWithPhotos(
  events: TripEvent[],
  userFlies: Fly[],
  catalog: FlyCatalog[],
): TripFlyWithPhoto[] {
  const seen = new Map<string, TripFlyWithPhoto>();
  for (const event of events) {
    if (event.event_type !== 'fly_change') continue;
    const data = coerceTripEventDataObject(event) as unknown as FlyChangeData;
    for (const slot of ['primary', 'dropper'] as const) {
      const row = slotFromChangeData(data, slot);
      if (!row || seen.has(row.key)) continue;
      row.photoUrl = resolveFlyPhotoUrlFromChangeData(data, slot, userFlies, catalog);
      seen.set(row.key, row);
    }
  }

  const catchCounts = countCatchesByFlyKey(events);

  return [...seen.values()]
    .map((fly) => ({ ...fly, catchCount: catchCounts.get(fly.key) ?? 0 }))
    .sort((a, b) => {
      if (b.catchCount !== a.catchCount) return b.catchCount - a.catchCount;
      return a.pattern.localeCompare(b.pattern);
    });
}
