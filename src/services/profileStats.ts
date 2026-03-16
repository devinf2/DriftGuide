import { supabase } from './supabase';
import { TripEvent, CatchData, FlyChangeData } from '@/src/types';

export interface FlyStat {
  name: string;
  uses: number;
  fishCaught: number;
}

export interface ProfileStats {
  tripCount: number;
  totalFish: number;
  totalCatches: number;
  speciesCount: number;
  fishPerMonth: { month: string; count: number }[];
  favoriteFly: FlyStat | null;
  bestFly: FlyStat | null;
}

export async function fetchProfileStats(
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<ProfileStats> {
  const { data: trips, error: tripError } = await supabase
    .from('trips')
    .select('id, total_fish, start_time')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .gte('start_time', startDate.toISOString())
    .lte('start_time', endDate.toISOString())
    .order('start_time', { ascending: true });

  const months = buildMonthArray(startDate, endDate);

  if (tripError || !trips || trips.length === 0) {
    return {
      tripCount: 0,
      totalFish: 0,
      totalCatches: 0,
      speciesCount: 0,
      fishPerMonth: months,
      favoriteFly: null,
      bestFly: null,
    };
  }

  const tripIds = trips.map((t: any) => t.id);

  const { data: events } = await supabase
    .from('trip_events')
    .select('id, trip_id, event_type, data')
    .in('trip_id', tripIds);

  const allEvents = (events || []) as TripEvent[];
  const catchEvents = allEvents.filter(e => e.event_type === 'catch');
  const flyEvents = allEvents.filter(e => e.event_type === 'fly_change');

  const species = new Set<string>();
  catchEvents.forEach(e => {
    const d = e.data as CatchData;
    if (d.species) species.add(d.species);
  });

  // Group by pattern (display name). When fly_id is present we could key by fly_id for per-variant stats and join catalog for name.
  const flyMap = new Map<string, { uses: number; fishCaught: number }>();
  flyEvents.forEach(e => {
    const d = e.data as FlyChangeData;
    const e1 = flyMap.get(d.pattern) || { uses: 0, fishCaught: 0 };
    e1.uses++;
    flyMap.set(d.pattern, e1);
    if (d.pattern2) {
      const e2 = flyMap.get(d.pattern2) || { uses: 0, fishCaught: 0 };
      e2.uses++;
      flyMap.set(d.pattern2, e2);
    }
  });

  catchEvents.forEach(e => {
    const d = e.data as CatchData;
    if (d.active_fly_event_id) {
      const fe = flyEvents.find(f => f.id === d.active_fly_event_id);
      if (fe) {
        const fd = fe.data as FlyChangeData;
        const pattern = d.caught_on_fly === 'dropper' && fd.pattern2 ? fd.pattern2 : fd.pattern;
        const entry = flyMap.get(pattern) || { uses: 0, fishCaught: 0 };
        entry.fishCaught++;
        flyMap.set(pattern, entry);
      }
    }
  });

  let favoriteFly: ProfileStats['favoriteFly'] = null;
  let bestFly: ProfileStats['bestFly'] = null;
  let maxUses = 0;
  let maxFishPerUse = 0;
  flyMap.forEach((stats, name) => {
    if (stats.uses > maxUses) {
      maxUses = stats.uses;
      favoriteFly = { name, ...stats };
    }
    if (stats.uses > 0) {
      const fishPerUse = stats.fishCaught / stats.uses;
      if (fishPerUse > maxFishPerUse) {
        maxFishPerUse = fishPerUse;
        bestFly = { name, ...stats };
      }
    }
  });

  trips.forEach((t: any) => {
    const d = new Date(t.start_time);
    const idx =
      (d.getFullYear() - startDate.getFullYear()) * 12 +
      d.getMonth() -
      startDate.getMonth();
    if (idx >= 0 && idx < months.length) {
      months[idx].count += t.total_fish || 0;
    }
  });

  return {
    tripCount: trips.length,
    totalFish: trips.reduce((s: number, t: any) => s + (t.total_fish || 0), 0),
    totalCatches: catchEvents.length,
    speciesCount: species.size,
    fishPerMonth: months,
    favoriteFly,
    bestFly,
  };
}

function buildMonthArray(
  start: Date,
  end: Date
): { month: string; count: number }[] {
  const result: { month: string; count: number }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  const spanMonths =
    (last.getFullYear() - cur.getFullYear()) * 12 +
    last.getMonth() -
    cur.getMonth();
  const includeYear = spanMonths >= 12;

  while (cur <= last) {
    const label = includeYear
      ? cur.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      : cur.toLocaleDateString('en-US', { month: 'short' });
    result.push({ month: label, count: 0 });
    cur.setMonth(cur.getMonth() + 1);
  }

  return result;
}
