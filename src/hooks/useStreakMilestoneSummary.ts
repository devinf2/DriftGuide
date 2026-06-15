/**
 * WS-G — Data hook feeding the StreakMilestoneCard.
 *
 * Loads the signed-in user's completed trips + catches and runs the PURE
 * streak/milestone math (src/utils/streaksMilestones.ts). Self-contained so the
 * home screen only needs to render <StreakMilestoneCard /> — no wiring required
 * beyond dropping the element in (see WS-G report).
 */
import { useCallback, useEffect, useState } from 'react';

import { fetchTripsFromCloud, fetchUserCatchesFromCloud } from '@/src/services/sync';
import { useAuthStore } from '@/src/stores/authStore';
import {
  summarizeStreaksAndMilestones,
  type MilestoneCatch,
  type StreakMilestoneSummary,
  type StreakTrip,
} from '@/src/utils/streaksMilestones';

export interface UseStreakMilestoneSummaryResult {
  summary: StreakMilestoneSummary | null;
  loading: boolean;
}

export function useStreakMilestoneSummary(): UseStreakMilestoneSummaryResult {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [summary, setSummary] = useState<StreakMilestoneSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (uid: string) => {
    setLoading(true);
    try {
      const [trips, catches] = await Promise.all([
        fetchTripsFromCloud(uid),
        fetchUserCatchesFromCloud(uid),
      ]);
      const streakTrips: StreakTrip[] = trips
        .filter((t) => t.status === 'completed')
        .map((t) => ({ date: t.start_time }));
      const milestoneCatches: MilestoneCatch[] = catches.map((c) => ({
        date: c.timestamp,
        species: c.species,
        sizeInches: c.size_inches,
        weightLb: c.weight_lb ?? null,
      }));
      setSummary(summarizeStreaksAndMilestones(streakTrips, milestoneCatches));
    } catch (err) {
      console.warn('[useStreakMilestoneSummary] load failed', err);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setSummary(null);
      return;
    }
    void load(userId);
  }, [userId, load]);

  return { summary, loading };
}
