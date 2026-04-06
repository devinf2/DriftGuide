import type { NetInfoState } from '@react-native-community/netinfo';

/**
 * Matches GlobalOfflineBanner / GuideChat: treat explicit no-internet as offline.
 * When `isInternetReachable` is null (unknown), we do not force offline — OS may still be checking.
 */
export function isAppReachableFromNetInfoState(state: NetInfoState): boolean {
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}
