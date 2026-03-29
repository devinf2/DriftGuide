import { Colors, LocationTypeColors } from '@/src/constants/theme';
import type { Location } from '@/src/types';
import { isPointInBoundingBox, type BoundingBox } from '@/src/types/boundingBox';
import { isLocationActive } from '@/src/utils/locationVisibility';
import { displayLngLatForOverlappingItems } from '@/src/utils/mapPinDisplayOffset';

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
  type Row = { loc: Location; lat: number; lon: number };
  const rows: Row[] = [];
  for (const loc of locations) {
    if (!isLocationActive(loc)) continue;
    if (excludeLocationId && loc.id === excludeLocationId) continue;
    const la = loc.latitude;
    const ln = loc.longitude;
    if (la == null || ln == null) continue;
    if (!isPointInBoundingBox(la, ln, dataViewport)) continue;
    rows.push({ loc, lat: la, lon: ln });
  }
  const displayCoords = displayLngLatForOverlappingItems(
    rows.map((r) => ({ id: r.loc.id, lat: r.lat, lng: r.lon })),
  );
  return rows.map((r) => {
    const coord = displayCoords.get(r.loc.id) ?? [r.lon, r.lat];
    const [lon, lat] = coord;
    return {
      id: `catalog-loc-${r.loc.id}`,
      lon,
      lat,
      title: r.loc.name,
      color: LocationTypeColors[r.loc.type] ?? Colors.textTertiary,
    };
  });
}
