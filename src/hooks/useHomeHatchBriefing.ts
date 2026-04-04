import {
  getRegionalHatchBriefing,
  type RegionalHatchWaterInput,
  type RegionalHatchBriefingResult,
} from '@/src/services/ai';
import { useEffect, useState } from 'react';

function watersSignature(w: RegionalHatchWaterInput[]): string {
  return JSON.stringify(
    w.map((x) => ({
      n: x.name,
      sky: x.conditions.sky.label,
      t: x.conditions.temperature.temp_f,
      flow: x.conditions.water.flow_cfs,
    })),
  );
}

/**
 * Fetches regional hatch rows after hot-spot conditions have loaded.
 */
export function useHomeHatchBriefing(
  enabled: boolean,
  hotSpotLoading: boolean,
  waters: RegionalHatchWaterInput[],
  refreshKey: number,
  userLat?: number | null,
  userLng?: number | null,
) {
  const [hatchBriefing, setHatchBriefing] = useState<RegionalHatchBriefingResult>({ rows: [] });
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHatchBriefing({ rows: [] });
      setFetching(false);
      return;
    }
    if (hotSpotLoading) {
      setFetching(false);
      return;
    }

    let cancelled = false;
    setFetching(true);
    getRegionalHatchBriefing(waters, new Date(), { userLat, userLng })
      .then((result) => {
        if (!cancelled) {
          const r = result?.rows;
          setHatchBriefing({ rows: Array.isArray(r) ? r : [] });
        }
      })
      .catch(() => {
        if (!cancelled) setHatchBriefing({ rows: [] });
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, hotSpotLoading, refreshKey, userLat, userLng, watersSignature(waters)]);

  return {
    hatchRows: Array.isArray(hatchBriefing.rows) ? hatchBriefing.rows : [],
    hatchLoading: hotSpotLoading || fetching,
  };
}
