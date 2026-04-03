import { fetchHistoricalWeather } from '@/src/services/historicalWeather';
import type { TripEvent } from '@/src/types';
import { buildEventConditionsSnapshot } from '@/src/utils/eventConditionsSnapshot';

function catchAlreadyHasConditionsSnapshot(e: TripEvent): boolean {
  if (e.event_type !== 'catch') return false;
  const s = e.conditions_snapshot;
  if (!s) return false;
  return Boolean(s.weather || s.waterFlow);
}

/**
 * For imported trips: attach historical weather to catch events that don't already have a snapshot
 * (e.g. modal skipped fetch). Uses catch coords, else trip location. No-op when offline.
 */
export async function enrichCatchEventsWithHistoricalConditions(
  events: TripEvent[],
  opts: {
    fallbackLat: number | null | undefined;
    fallbackLon: number | null | undefined;
    isOnline: boolean;
  },
): Promise<TripEvent[]> {
  if (!opts.isOnline) return events;

  const fallbackLat =
    opts.fallbackLat != null && Number.isFinite(opts.fallbackLat) ? opts.fallbackLat : null;
  const fallbackLon =
    opts.fallbackLon != null && Number.isFinite(opts.fallbackLon) ? opts.fallbackLon : null;

  const out: TripEvent[] = [];

  for (const e of events) {
    if (e.event_type !== 'catch') {
      out.push(e);
      continue;
    }
    if (catchAlreadyHasConditionsSnapshot(e)) {
      out.push(e);
      continue;
    }

    const laRaw = e.latitude ?? fallbackLat;
    const loRaw = e.longitude ?? fallbackLon;
    if (laRaw == null || loRaw == null) {
      out.push(e);
      continue;
    }
    const la = Number(laRaw);
    const lo = Number(loRaw);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) {
      out.push(e);
      continue;
    }

    const at = new Date(e.timestamp);
    if (Number.isNaN(at.getTime())) {
      out.push(e);
      continue;
    }

    try {
      const hist = await fetchHistoricalWeather(la, lo, at);
      if (!hist) {
        out.push(e);
        continue;
      }
      const snap = buildEventConditionsSnapshot(hist, null, at);
      out.push(snap ? { ...e, conditions_snapshot: snap } : e);
    } catch {
      out.push(e);
    }
  }

  return out;
}
