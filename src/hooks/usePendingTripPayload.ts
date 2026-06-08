import { useEffect, useState } from 'react';
import { getPendingTrips, type PendingTripPayload } from '@/src/services/pendingSyncStorage';
import { useTripStore } from '@/src/stores/tripStore';
import type { Trip } from '@/src/types';

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

/**
 * Completed trips for `userId` that are saved on this device and still waiting to upload to the cloud.
 * Used by the journal to show placeholder "uploading" cards so an offline trip never silently disappears.
 */
export function usePendingJournalTrips(userId: string | undefined): Trip[] {
  const pendingSyncTrips = useTripStore((s) => s.pendingSyncTrips);
  const isSyncingPending = useTripStore((s) => s.isSyncingPending);
  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    if (!userId || pendingSyncTrips.length === 0) {
      setTrips([]);
      return;
    }
    let cancelled = false;
    void getPendingTrips().then((m) => {
      if (cancelled) return;
      const pending = pendingSyncTrips
        .map((id) => m[id]?.trip)
        .filter(
          (t): t is Trip => !!t && t.user_id === userId && t.status === 'completed',
        );
      setTrips(pending);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, pendingSyncTrips, isSyncingPending]);

  return trips;
}
