import { MaterialIcons } from '@expo/vector-icons';
import * as ExpoLocation from 'expo-location';
import { useMemo } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';
import { USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { BorderRadius, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';

/** Minimal slice of the rnmapbox `Camera` ref used to animate the viewport. */
export type CameraControl = {
  setCamera?: (config: {
    type: 'CameraStop';
    centerCoordinate: [number, number];
    zoomLevel: number;
    animationDuration: number;
    animationMode: 'flyTo' | 'easeTo' | 'moveTo';
  }) => void;
};

/**
 * Request foreground location permission and animate `camera` to the user's position.
 * Returns true if a fix was obtained (so callers can reveal the location puck).
 */
export async function flyCameraToUserLocation(camera: CameraControl | null): Promise<boolean> {
  try {
    const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Location off',
        'Allow location access for DriftGuide in Settings to center the map on where you are.',
      );
      return false;
    }
    const loc = await ExpoLocation.getCurrentPositionAsync({
      accuracy: ExpoLocation.Accuracy.Balanced,
    });
    const { latitude, longitude } = loc.coords;
    camera?.setCamera?.({
      type: 'CameraStop',
      centerCoordinate: [longitude, latitude],
      zoomLevel: USER_LOCATION_ZOOM,
      animationDuration: 520,
      animationMode: 'flyTo',
    });
    return true;
  } catch {
    Alert.alert('Location unavailable', 'Could not get your current location. Try again outdoors.');
    return false;
  }
}

/** Round FAB that recenters the map on the user's current GPS position. */
export function MapLocateButton({
  side,
  bottom,
  busy,
  onPress,
}: {
  /** Sit opposite the basemap switcher so it never overlaps the bottom controls. */
  side: 'left' | 'right';
  bottom: number;
  busy: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Center map on my location"
      style={[
        styles.fab,
        side === 'left' ? { left: Spacing.md } : { right: Spacing.md },
        { bottom },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <MaterialIcons name="my-location" size={22} color={colors.primary} />
      )}
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    fab: {
      position: 'absolute',
      width: 44,
      height: 44,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 3,
      elevation: 4,
    },
  });
}
