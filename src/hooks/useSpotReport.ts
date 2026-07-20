import { fetchLocationConditions } from '@/src/services/conditions';
import { getSpotFishingSummary, type SpotFishingSummary } from '@/src/services/ai';
import type { Location, LocationConditions } from '@/src/types';
import { useEffect, useRef, useState } from 'react';

/**
 * Report data for one water on the home "Report" tab. Online only: resolves conditions (reusing the
 * home hot-spot bundle's conditions when the water is already ranked, else fetching them), then the
 * AI spot summary (report + top flies + best time), memoized per-location for the session. Offline
 * it fetches nothing (summary stays null) — the Report tab renders the curated OfflineFallbackGuide.
 */
export type SpotReport = {
  conditions: LocationConditions | null;
  summary: SpotFishingSummary | null;
  conditionsLoading: boolean;
  summaryLoading: boolean;
};

const conditionsCache = new Map<string, LocationConditions>();
const summaryCache = new Map<string, SpotFishingSummary>();

export function useSpotReport(
  location: Location | null,
  seedConditions: LocationConditions | null,
  allLocations: Location[],
  online: boolean,
  communityFishN?: number,
): SpotReport {
  const [conditions, setConditions] = useState<LocationConditions | null>(null);
  const [summary, setSummary] = useState<SpotFishingSummary | null>(null);
  const [conditionsLoading, setConditionsLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  /** Guards against a slower fetch for a previous water overwriting the current one. */
  const activeIdRef = useRef<string | null>(null);

  // Resolve conditions for the active water.
  useEffect(() => {
    const loc = location;
    if (!loc) {
      setConditions(null);
      return;
    }
    activeIdRef.current = loc.id;

    if (seedConditions) {
      conditionsCache.set(loc.id, seedConditions);
      setConditions(seedConditions);
      return;
    }
    const cached = conditionsCache.get(loc.id);
    if (cached) {
      setConditions(cached);
      return;
    }
    // Offline: no network — fall back to whatever the offline guide can do without live conditions.
    if (!online) {
      setConditions(null);
      return;
    }

    let cancelled = false;
    setConditions(null);
    setConditionsLoading(true);
    fetchLocationConditions(loc, allLocations)
      .then((cond) => {
        if (cancelled || activeIdRef.current !== loc.id) return;
        conditionsCache.set(loc.id, cond);
        setConditions(cond);
      })
      .catch(() => {
        if (!cancelled && activeIdRef.current === loc.id) setConditions(null);
      })
      .finally(() => {
        if (!cancelled && activeIdRef.current === loc.id) setConditionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // seedConditions intentionally read by identity: a ranked water passes a stable object.
  }, [location, seedConditions, allLocations, online]);

  // Build the summary: the AI summary online, the offline guide otherwise.
  useEffect(() => {
    const loc = location;
    if (!loc) {
      setSummary(null);
      return;
    }

    if (!online) {
      // Offline: no network summary — the Report tab shows the curated OfflineFallbackGuide instead.
      setSummaryLoading(false);
      setSummary(null);
      return;
    }

    if (!conditions) {
      setSummary(null);
      return;
    }
    const cached = summaryCache.get(loc.id);
    if (cached) {
      setSummary(cached);
      return;
    }

    let cancelled = false;
    setSummary(null);
    setSummaryLoading(true);
    getSpotFishingSummary(loc.name, conditions, {
      latitude: loc.latitude,
      longitude: loc.longitude,
      communityFishN,
    })
      .then((s) => {
        if (cancelled || activeIdRef.current !== loc.id) return;
        summaryCache.set(loc.id, s);
        setSummary(s);
      })
      .catch(() => {
        if (!cancelled && activeIdRef.current === loc.id) setSummary(null);
      })
      .finally(() => {
        if (!cancelled && activeIdRef.current === loc.id) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [location, conditions, communityFishN, online]);

  return { conditions, summary, conditionsLoading, summaryLoading };
}
