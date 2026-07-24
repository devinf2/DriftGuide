import type { MapboxMapMarker } from '@/src/components/map/TripMapboxMapView';
import type { Business, BusinessCategory } from '@/src/types';
import { displayLngLatForOverlappingItems } from '@/src/utils/mapPinDisplayOffset';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';

const PIN = 22;
const ICON = 12;

/**
 * Businesses use a warm accent so commercial pins stay visually distinct from the
 * blue/teal waterway catalog pins. One color for the whole layer keeps the map
 * legible; the icon carries the category.
 */
const BUSINESS_ACCENT: Record<'light' | 'dark', string> = {
  light: '#C2703D',
  dark: '#E8A06A',
};

function businessMarkerIcon(category: BusinessCategory): keyof typeof Ionicons.glyphMap {
  switch (category) {
    case 'fly_shop':
      return 'storefront';
    case 'lodge':
      return 'bed';
    case 'outfitter':
      return 'compass';
    case 'guide_service':
      return 'person';
    default:
      return 'business';
  }
}

/**
 * Business directory pins for {@link TripMapboxMapView}. Mirrors
 * {@link buildCatalogMapboxMarkers}: `useMarkerView` so Ionicons render, and
 * collocated pins are nudged apart. Deleted/invalid rows are filtered out.
 */
export function buildBusinessMapboxMarkers(
  businesses: Business[],
  onPress: (business: Business) => void,
  colorScheme: 'light' | 'dark',
): MapboxMapMarker[] {
  const list = businesses.filter(
    (b) =>
      b.deleted_at == null &&
      b.latitude != null &&
      b.longitude != null &&
      Number.isFinite(b.latitude) &&
      Number.isFinite(b.longitude),
  );

  const displayCoords = displayLngLatForOverlappingItems(
    list.map((b) => ({ id: b.id, lat: b.latitude, lng: b.longitude })),
  );

  const accent = BUSINESS_ACCENT[colorScheme];

  return list.map((b) => {
    const coord = displayCoords.get(b.id) ?? [b.longitude, b.latitude];
    return {
      id: `biz-${b.id}`,
      coordinate: coord,
      onPress: () => onPress(b),
      useMarkerView: true,
      children: (
        <View
          style={{
            width: PIN,
            height: PIN,
            borderRadius: 5,
            backgroundColor: accent,
            borderWidth: 1.5,
            borderColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 1.5,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
          }}
        >
          <Ionicons name={businessMarkerIcon(b.category)} size={ICON} color="#FFFFFF" />
        </View>
      ),
    };
  });
}
