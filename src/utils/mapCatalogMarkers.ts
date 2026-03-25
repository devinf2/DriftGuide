import { Colors, LocationTypeColors } from '@/src/constants/theme';
import type { Location } from '@/src/types';
import { isPointInBoundingBox, type BoundingBox } from '@/src/types/boundingBox';

export type CatalogMapMarker = {
  id: string;
  lon: number;
  lat: number;
  title: string;
  color: string;
  /** Set on trip start/end pins only; catalog pins omit. */
  endpointLabel?: 'Start' | 'End';
  endpointIcon?: 'place' | 'flag';
  /** Trip/catch pins only; catalog pins omit. */
  catchEventId?: string;
  catchPhotoUrl?: string | null;
};

/**
 * Pins for Supabase `locations` rows that have coordinates and lie inside `dataViewport`.
 * Omit `excludeLocationId` when every catalog pin should show (e.g. spot screen).
 */
export function catalogLocationMarkersInViewport(
  locations: Location[],
  dataViewport: BoundingBox | null,
  excludeLocationId: string | null | undefined,
): CatalogMapMarker[] {
  if (!dataViewport) return [];
  const markers: CatalogMapMarker[] = [];
  for (const loc of locations) {
    if (excludeLocationId && loc.id === excludeLocationId) continue;
    const la = loc.latitude;
    const ln = loc.longitude;
    if (la == null || ln == null) continue;
    if (!isPointInBoundingBox(la, ln, dataViewport)) continue;
    markers.push({
      id: `catalog-loc-${loc.id}`,
      lon: ln,
      lat: la,
      title: loc.name,
      color: LocationTypeColors[loc.type] ?? Colors.textTertiary,
    });
  }
  return markers;
}
