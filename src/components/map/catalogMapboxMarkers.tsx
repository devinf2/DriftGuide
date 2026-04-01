import { CatalogLocationMapIcon } from '@/src/components/map/catalogLocationMapIcon';
import type { MapboxMapMarker } from '@/src/components/map/TripMapboxMapView';
import { locationTypeMapPinAccent, type ThemeColors } from '@/src/constants/theme';
import type { Location, LocationType } from '@/src/types';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';
import {
  COORD_STACK_EPS,
  displayLngLatForOverlappingItems,
} from '@/src/utils/mapPinDisplayOffset';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

function isWaterwayType(t: LocationType): boolean {
  return t === 'river' || t === 'stream' || t === 'lake' || t === 'reservoir' || t === 'pond';
}

const PIN = 22;
const ICON = 12;

function catalogMarkerIcon(type: LocationType): keyof typeof Ionicons.glyphMap {
  if (isWaterwayType(type)) return 'water';
  return 'location';
}

function CatalogPinIcon({ type, color }: { type: LocationType; color: string }) {
  if (type === 'parking' || type === 'access_point') {
    return <CatalogLocationMapIcon type={type} color={color} size={ICON} />;
  }
  return <Ionicons name={catalogMarkerIcon(type)} size={ICON} color={color} />;
}

/**
 * Roots (no parent) are drawn first; children are drawn last so they sit on top and match the
 * user’s tap when pins overlap.
 */
function compareLocationsForPinStack(a: Location, b: Location): number {
  const alat = a.latitude!;
  const alng = a.longitude!;
  const blat = b.latitude!;
  const blng = b.longitude!;
  if (Math.abs(alat - blat) > COORD_STACK_EPS) return alat - blat;
  if (Math.abs(alng - blng) > COORD_STACK_EPS) return alng - blng;
  const aChild = a.parent_location_id != null ? 1 : 0;
  const bChild = b.parent_location_id != null ? 1 : 0;
  return aChild - bChild;
}

export type CatalogMapChromeColors = Pick<ThemeColors, 'primary' | 'surface' | 'surfaceElevated'> & {
  colorScheme: 'light' | 'dark';
};

/**
 * DriftGuide catalog pins for {@link TripMapboxMapView}.
 * Uses `useMarkerView` so Ionicons render (PointAnnotation bitmap snapshots drop vector icons).
 * Every location with coordinates gets a pin; collocated pins are slightly offset so both stay visible.
 */
export function buildCatalogMapboxMarkers(
  locations: Location[],
  onLocationPress: (loc: Location) => void,
  mapChrome: CatalogMapChromeColors,
): MapboxMapMarker[] {
  const list = activeLocationsOnly(locations)
    .filter(
      (l) =>
        l.latitude != null &&
        l.longitude != null &&
        Number.isFinite(l.latitude) &&
        Number.isFinite(l.longitude),
    )
    .sort(compareLocationsForPinStack);

  const displayCoords = displayLngLatForOverlappingItems(
    list.map((loc) => ({ id: loc.id, lat: loc.latitude!, lng: loc.longitude! })),
  );

  const pinFill =
    mapChrome.colorScheme === 'dark' ? mapChrome.surfaceElevated : mapChrome.surface;

  return list.map((loc) => {
    const accent = locationTypeMapPinAccent(loc.type, mapChrome.colorScheme, mapChrome.primary);
    const coord = displayCoords.get(loc.id) ?? [loc.longitude!, loc.latitude!];
    return {
      id: `cat-${loc.id}`,
      coordinate: coord,
      onPress: () => onLocationPress(loc),
      useMarkerView: true,
      children: (
        <View
          style={{
            width: PIN,
            height: PIN,
            borderRadius: PIN / 2,
            backgroundColor: pinFill,
            borderWidth: 1.5,
            borderColor: accent,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 1.5,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
          }}
        >
          <CatalogPinIcon type={loc.type} color={accent} />
        </View>
      ),
    };
  });
}
