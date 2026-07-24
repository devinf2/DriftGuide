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

/** Ensure a user-entered URL has a scheme so the OS can open it. */
function withScheme(url: string): string {
  const trimmed = url.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed; // already has http(s):, tel:, mailto:, etc.
  return `https://${trimmed}`;
}

/**
 * Confirms intent (we're about to leave the app) then opens an external URL —
 * a business website, a partner deal / community link, etc. Shared so the
 * "leaving the app" copy stays consistent with {@link confirmDrivingDirections}.
 */
export function confirmOpenExternalUrl(url: string, label?: string): void {
  const target = url?.trim();
  if (!target) return;
  const dest = withScheme(target);
  const what = label?.trim() ? label.trim() : 'this link';
  Alert.alert('Leave DriftGuide', `Open ${what} in your browser?`, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Open',
      onPress: () => {
        void (async () => {
          try {
            await Linking.openURL(dest);
          } catch {
            // Unsupported scheme / no handler — silently ignore (matches directions behavior).
          }
        })();
      },
    },
  ]);
}

/** Opens the phone dialer for a number (no confirm — the OS dialer already confirms the call). */
export function openPhone(phone: string): void {
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits) return;
  void Linking.openURL(`tel:${digits}`).catch(() => {});
}

/** Opens the mail composer to an address. */
export function openEmail(email: string): void {
  const addr = email.trim();
  if (!addr) return;
  void Linking.openURL(`mailto:${addr}`).catch(() => {});
}
