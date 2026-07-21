import { Alert, Linking, Platform } from 'react-native';

/**
 * Opens the device's native maps app with driving directions to a point.
 * iOS → Apple Maps, Android → Google Maps navigation, with a universal web fallback.
 *
 * We chain openURL attempts (rather than canOpenURL) so we don't depend on the
 * app's URL-scheme allowlist — the first scheme the OS can handle wins.
 */
export async function openDrivingDirections(
  latitude: number,
  longitude: number,
): Promise<void> {
  const dest = `${latitude},${longitude}`;
  const webFallback = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
  const candidates =
    Platform.select({
      ios: [`maps://?daddr=${dest}&dirflg=d`, `http://maps.apple.com/?daddr=${dest}&dirflg=d`],
      android: [`google.navigation:q=${dest}`, `geo:${dest}?q=${dest}`],
      default: [webFallback],
    }) ?? [];

  for (const url of [...candidates, webFallback]) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // Scheme unsupported on this device — fall through to the next candidate.
    }
  }
}

/**
 * Confirms intent (we're about to leave the app) then opens driving directions.
 * Shared by every "Directions" affordance so the copy and behavior stay consistent.
 */
export function confirmDrivingDirections(latitude: number, longitude: number, label?: string): void {
  const dest = label?.trim() ? label.trim() : 'this spot';
  Alert.alert('Get Directions', `Open driving directions to ${dest} in your maps app?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Directions', onPress: () => void openDrivingDirections(latitude, longitude) },
  ]);
}
