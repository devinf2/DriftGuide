import type { Location } from '@/src/types';

/**
 * Soft-deleted rows are hidden from maps, search, and parent-candidate prompts.
 * Any non-empty `deleted_at` (timestamptz from API) means inactive.
 */
export function isLocationActive(l: Pick<Location, 'deleted_at'>): boolean {
  const d = l.deleted_at;
  return d == null || d === '';
}

export function activeLocationsOnly(locations: Location[]): Location[] {
  return locations.filter(isLocationActive);
}
