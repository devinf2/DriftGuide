import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { useTripStore } from '@/src/stores/tripStore';
import { useAuthStore } from '@/src/stores/authStore';
import { syncTripToCloud } from '@/src/services/sync';
import { flushPendingCatches } from '@/src/services/mapCatchLocalStore';
import { syncPendingUserCatches } from '@/src/services/userCatchService';
import { refreshAllIfStale } from '@/src/services/waterwayCache';
import { processPendingPhotos } from '@/src/services/processPendingPhotos';
import { flushPendingFlyOps } from '@/src/services/flyService';

const DEBOUNCE_MS = 2000;
const WATERWAY_REFRESH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function SyncOnConnectivity() {
  const { isConnected } = useNetworkStatus();
  const userId = useAuthStore((s) => s.user?.id);
  const retryPendingSyncs = useTripStore((s) => s.retryPendingSyncs);
  const setOnlineStatus = useTripStore((s) => s.setOnlineStatus);
  const lastRunRef = useRef<number>(0);
  const inProgressRef = useRef(false);

  useEffect(() => {
    setOnlineStatus(isConnected);
  }, [isConnected, setOnlineStatus]);

  useEffect(() => {
    if (!isConnected) return;

    const run = async () => {
      if (inProgressRef.current) return;
      const now = Date.now();
      if (now - lastRunRef.current < DEBOUNCE_MS) return;
      lastRunRef.current = now;
      inProgressRef.current = true;
      try {
        if (userId) {
          await syncPendingUserCatches(userId);
        }
        await flushPendingCatches();
        await retryPendingSyncs();
        const { activeTrip, events } = useTripStore.getState();
        if (activeTrip && events) {
          await syncTripToCloud(activeTrip, events);
        }
        await processPendingPhotos();
        await flushPendingFlyOps();
        await refreshAllIfStale(WATERWAY_REFRESH_MAX_AGE_MS, userId);
      } finally {
        inProgressRef.current = false;
      }
    };

    run();
  }, [isConnected, retryPendingSyncs, userId]);

  useEffect(() => {
    if (!isConnected) return;

    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        const now = Date.now();
        if (now - lastRunRef.current < DEBOUNCE_MS) return;
        lastRunRef.current = now;
        inProgressRef.current = true;
        (async () => {
          const uid = useAuthStore.getState().user?.id;
          if (uid) await syncPendingUserCatches(uid);
          await flushPendingCatches();
          await retryPendingSyncs();
          const { activeTrip: at, events: ev } = useTripStore.getState();
          if (at && ev) await syncTripToCloud(at, ev);
          await processPendingPhotos();
          await flushPendingFlyOps();
          await refreshAllIfStale(WATERWAY_REFRESH_MAX_AGE_MS, uid);
        })()
          .finally(() => {
            inProgressRef.current = false;
          });
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [isConnected, retryPendingSyncs]);

  return null;
}
