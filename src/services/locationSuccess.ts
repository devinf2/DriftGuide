import { supabase } from './supabase';
import type { FlyChangeData, CatchData } from '@/src/types';

/** Build a short summary of recent success at a location for AI context (e.g. "Pheasant Tail #18, BWO #20; 12 fish in last 7 days"). */
export async function getLocationSuccessSummary(
  locationId: string,
  options?: { daysBack?: number; limitTrips?: number }
): Promise<string> {
  const daysBack = options?.daysBack ?? 30;
  const limitTrips = options?.limitTrips ?? 20;
  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  const { data: trips, error: tripError } = await supabase
    .from('trips')
    .select('id, total_fish, start_time')
    .eq('location_id', locationId)
    .eq('status', 'completed')
    .gte('start_time', since.toISOString())
    .order('start_time', { ascending: false })
    .limit(limitTrips);

  if (tripError || !trips || trips.length === 0) {
    return 'No recent completed trips at this location.';
  }

  const tripIds = trips.map((t: { id: string }) => t.id);
  const totalFish = trips.reduce((s: number, t: { total_fish?: number }) => s + (t.total_fish || 0), 0);

  const { data: events } = await supabase
    .from('trip_events')
    .select('id, trip_id, event_type, data')
    .in('trip_id', tripIds);

  const allEvents = (events || []) as { id: string; trip_id: string; event_type: string; data: unknown }[];
  const catchEvents = allEvents.filter(e => e.event_type === 'catch');
  const flyEvents = allEvents.filter(e => e.event_type === 'fly_change');

  const flyFishCount = new Map<string, number>();
  catchEvents.forEach(e => {
    const d = e.data as CatchData;
    if (!d.active_fly_event_id) return;
    const fe = flyEvents.find((f: { id: string }) => f.id === d.active_fly_event_id);
    if (!fe) return;
    const fd = fe.data as FlyChangeData;
    const pattern = d.caught_on_fly === 'dropper' && fd.pattern2 ? fd.pattern2 : fd.pattern;
    const size = d.caught_on_fly === 'dropper' && fd.pattern2 ? fd.size2 : fd.size;
    const key = size != null ? `${pattern} #${size}` : pattern;
    flyFishCount.set(key, (flyFishCount.get(key) || 0) + 1);
  });

  const topFlies = [...flyFishCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  if (topFlies.length === 0) {
    return `Recent success: ${totalFish} fish in last ${daysBack} days (no fly detail).`;
  }
  return `Recent success here: ${topFlies.join(', ')}; ${totalFish} fish in last ${daysBack} days.`;
}
