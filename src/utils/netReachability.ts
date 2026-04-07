import type { NetInfoState } from '@react-native-community/netinfo';
import { useSimulateOfflineStore } from '@/src/stores/simulateOfflineStore';

/**
 * Matches GlobalOfflineBanner / GuideChat: treat explicit no-internet as offline.
 * When `isInternetReachable` is null (unknown), we do not force offline — OS may still be checking.
 */
export function isAppReachableFromNetInfoState(state: NetInfoState): boolean {
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

/**
 * When "Simulate offline" is on in **development**, the app behaves as unreachable.
 * `__DEV__` is always false in release/production builds, so this never affects App Store / EAS prod.
 */
export function effectiveIsAppOnline(netInfoSaysOnline: boolean): boolean {
  if (!__DEV__) return netInfoSaysOnline;
  if (useSimulateOfflineStore.getState().simulateOffline) return false;
  return netInfoSaysOnline;
}
