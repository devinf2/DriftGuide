import { useEffect, useState } from 'react';
import { getPendingTrips, type PendingTripPayload } from '@/src/services/pendingSyncStorage';
import { useTripStore } from '@/src/stores/tripStore';

/**
 * Latest pending-sync payload for a trip (AsyncStorage), when this user owns the trip and it is queued.
 */
export function usePendingTripPayloadForTrip(tripId: string, enabled: boolean): PendingTripPayload | null {
  const pendingSyncTrips = useTripStore((s) => s.pendingSyncTrips);
  const isSyncingPending = useTripStore((s) => s.isSyncingPending);
  const [pendingPayload, setPendingPayload] = useState<PendingTripPayload | null>(null);

  useEffect(() => {
    if (!enabled || !pendingSyncTrips.includes(tripId)) {
      setPendingPayload(null);
      return;
    }
    void getPendingTrips().then((m) => setPendingPayload(m[tripId] ?? null));
  }, [tripId, enabled, pendingSyncTrips, isSyncingPending]);

  return pendingPayload;
}
