import { useEffect, useMemo, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { effectiveIsAppOnline, isAppReachableFromNetInfoState } from '@/src/utils/netReachability';
import { useSimulateOfflineStore } from '@/src/stores/simulateOfflineStore';

/**
 * App-level network: aligned with GlobalOfflineBanner (`isInternetReachable === false` ⇒ offline).
 * Starts pessimistic (false) until the first NetInfo result to reduce hangs on stranded Wi‑Fi.
 * `isConnected` kept for call-site compatibility — means "reachable enough to use the API".
 */
export function useNetworkStatus() {
  const [netReachable, setNetReachable] = useState(false);
  const [connectionType, setConnectionType] = useState<string | null>(null);
  const simulateOffline = useSimulateOfflineStore((s) => s.simulateOffline);

  useEffect(() => {
    let cancelled = false;

    const apply = (state: NetInfoState) => {
      if (cancelled) return;
      setNetReachable(isAppReachableFromNetInfoState(state));
      setConnectionType(state.type);
    };

    void NetInfo.fetch().then(apply);

    const unsubscribe = NetInfo.addEventListener(apply);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const isConnected = useMemo(
    () => effectiveIsAppOnline(netReachable),
    [netReachable, simulateOffline],
  );

  return { isConnected, connectionType };
}
