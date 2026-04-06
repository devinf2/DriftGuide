import type { Location } from '@/src/types';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';

/** Dedupe by id; later lists override earlier. */
export function mergeLocationsById(...lists: Location[][]): Location[] {
  const m = new Map<string, Location>();
  for (const list of lists) {
    for (const loc of activeLocationsOnly(list)) {
      m.set(loc.id, loc);
    }
  }
  return [...m.values()];
}
