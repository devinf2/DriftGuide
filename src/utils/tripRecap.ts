import type { CatchData, TripEvent, WaterClarity } from '@/src/types';
import { coerceTripEventDataObject, formatCatchWeightLabel } from '@/src/utils/journalTimeline';

/** The standout catch of the trip (largest by length, then weight). */
export type TripRecapBiggest = {
  event: TripEvent;
  species: string | null;
  sizeInches: number | null;
  weightLabel: string | null;
  timestamp: string;
};

/** The clock hour (local) that produced the most fish, when one clearly stood out. */
export type TripRecapHotHour = {
  /** 0–23, local device time. */
  startHour: number;
  count: number;
};

export type TripRecapWater = {
  tempF: number | null;
  clarity: WaterClarity | null;
  flowCfs: number | null;
};

export type TripRecap = {
  biggest: TripRecapBiggest | null;
  hotHour: TripRecapHotHour | null;
  water: TripRecapWater | null;
};

function catchDataOf(event: TripEvent): CatchData {
  return coerceTripEventDataObject(event) as unknown as CatchData;
}

/** Ordering metric so a longer fish always outranks a shorter one, weight breaks ties. */
function catchSizeScore(data: CatchData): number {
  const inches = data.size_inches ?? 0;
  const oz = (data.weight_lb ?? 0) * 16 + (data.weight_oz ?? 0);
  // Length dominates; weight is a fractional tiebreak that can never cross an inch.
  return inches * 100 + Math.min(oz, 99);
}

/** Catches sorted largest-first (length, then weight). Reused for hero selection. */
export function catchesBySizeDesc(events: TripEvent[]): TripEvent[] {
  return events
    .filter((e) => e.event_type === 'catch')
    .sort((a, b) => catchSizeScore(catchDataOf(b)) - catchSizeScore(catchDataOf(a)));
}

function biggestCatch(events: TripEvent[]): TripRecapBiggest | null {
  const sorted = catchesBySizeDesc(events);
  const top = sorted[0];
  if (!top) return null;
  const data = catchDataOf(top);
  // Skip a meaningless "biggest" when there's no size, weight, or species to show.
  if (data.size_inches == null && data.weight_lb == null && data.weight_oz == null && !data.species?.trim()) {
    return null;
  }
  return {
    event: top,
    species: data.species?.trim() || null,
    sizeInches: data.size_inches ?? null,
    weightLabel: formatCatchWeightLabel(data.weight_lb, data.weight_oz),
    timestamp: top.timestamp,
  };
}

function hotHour(events: TripEvent[]): TripRecapHotHour | null {
  const byHour = new Map<number, number>();
  for (const e of events) {
    if (e.event_type !== 'catch') continue;
    const hour = new Date(e.timestamp).getHours();
    if (Number.isNaN(hour)) continue;
    const qty = Math.max(1, catchDataOf(e).quantity ?? 1);
    byHour.set(hour, (byHour.get(hour) ?? 0) + qty);
  }
  let best: TripRecapHotHour | null = null;
  for (const [startHour, count] of byHour) {
    if (!best || count > best.count) best = { startHour, count };
  }
  // Only surface a "hot bite" when a window genuinely stood out.
  return best && best.count >= 2 ? best : null;
}

function water(events: TripEvent[]): TripRecapWater | null {
  // Prefer the most recent snapshot with real water data (later in the day = more representative).
  const withFlow = events
    .filter((e) => e.conditions_snapshot?.waterFlow != null)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const flow = withFlow[0]?.conditions_snapshot?.waterFlow ?? null;
  if (!flow) return null;
  const clarity = flow.clarity && flow.clarity !== 'unknown' ? flow.clarity : null;
  if (flow.water_temp_f == null && clarity == null && flow.flow_cfs == null) return null;
  return { tempF: flow.water_temp_f, clarity, flowCfs: flow.flow_cfs ?? null };
}

/** Highlights for the trip recap section — all derived from the trip's own events. */
export function buildTripRecap(events: TripEvent[]): TripRecap {
  return {
    biggest: biggestCatch(events),
    hotHour: hotHour(events),
    water: water(events),
  };
}

/** "7–8 PM" style label for a local clock hour. */
export function formatHourWindowLabel(startHour: number): string {
  const fmt = (h: number) => {
    const period = h < 12 ? 'AM' : 'PM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return { hour12, period };
  };
  const start = fmt(startHour);
  const end = fmt((startHour + 1) % 24);
  // Collapse the period when both ends share it: "7–8 PM" rather than "7 PM–8 PM".
  if (start.period === end.period) return `${start.hour12}–${end.hour12} ${end.period}`;
  return `${start.hour12} ${start.period}–${end.hour12} ${end.period}`;
}
