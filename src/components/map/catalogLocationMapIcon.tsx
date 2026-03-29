import { MaterialIcons } from '@expo/vector-icons';
import type { LocationType } from '@/src/types';

/**
 * Material map pin for catalog locations: parking → Local Parking, access point → Directions Walk.
 */
export function CatalogLocationMapIcon({
  type,
  color,
  size = 34,
}: {
  type?: LocationType;
  color: string;
  size?: number;
}) {
  if (type === 'parking') {
    return <MaterialIcons name="local-parking" size={size} color={color} />;
  }
  if (type === 'access_point') {
    return <MaterialIcons name="directions-walk" size={size} color={color} />;
  }
  return <MaterialIcons name="place" size={size} color={color} />;
}
