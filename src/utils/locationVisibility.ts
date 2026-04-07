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

/**
 * Same rule as RLS on `locations`: public rows (is_public not false) or created by the viewer.
 * Matches `coalesce(is_public, true) = true or created_by = auth.uid()`.
 */
export function isLocationVisibleToViewer(
  l: Pick<Location, 'is_public' | 'created_by'>,
  viewerId: string | null | undefined,
): boolean {
  if (l.is_public !== false) return true;
  return viewerId != null && l.created_by === viewerId;
}

export function locationsVisibleToViewer(
  locations: Location[],
  viewerId: string | null | undefined,
): Location[] {
  return locations.filter((loc) => isLocationVisibleToViewer(loc, viewerId));
}
