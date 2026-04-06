import { useEffect, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { isAppReachableFromNetInfoState } from '@/src/utils/netReachability';

/**
 * App-level network: aligned with GlobalOfflineBanner (`isInternetReachable === false` ⇒ offline).
 * Starts pessimistic (false) until the first NetInfo result to reduce hangs on stranded Wi‑Fi.
 * `isConnected` kept for call-site compatibility — means "reachable enough to use the API".
 */
export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionType, setConnectionType] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const apply = (state: NetInfoState) => {
      if (cancelled) return;
      setIsConnected(isAppReachableFromNetInfoState(state));
      setConnectionType(state.type);
    };

    void NetInfo.fetch().then(apply);

    const unsubscribe = NetInfo.addEventListener(apply);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { isConnected, connectionType };
}
