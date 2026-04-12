import type { CatchData, FlyChangeData, TripEvent } from '@/src/types';

/** Resolve fly pattern/size/color for a catch from events (fly_change referenced by active_fly_event_id). */
export function getFlyForCatch(
  catchData: CatchData,
  events: TripEvent[],
): { fly_pattern: string | null; fly_size: number | null; fly_color: string | null } {
  if (!catchData.active_fly_event_id) return { fly_pattern: null, fly_size: null, fly_color: null };
  const flyEvent = events.find(
    (e) => e.id === catchData.active_fly_event_id && e.event_type === 'fly_change',
  );
  if (!flyEvent) return { fly_pattern: null, fly_size: null, fly_color: null };
  const d = flyEvent.data as FlyChangeData;
  const useDropper = catchData.caught_on_fly === 'dropper';
  return {
    fly_pattern: (useDropper && d.pattern2 ? d.pattern2 : d.pattern) ?? null,
    fly_size: (useDropper && d.size2 != null ? d.size2 : d.size) ?? null,
    fly_color: (useDropper && d.color2 ? d.color2 : d.color) ?? null,
  };
}
