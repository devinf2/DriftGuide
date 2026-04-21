import type { HatchBriefRow } from '@/src/services/ai';
import { loadHomeHotSpotsBundle, type HomeHotSpotData, type WaterConditionsBrief } from '@/src/utils/homeHotSpots';
import { useLocationFavoritesStore } from '@/src/stores/locationFavoritesStore';
import { useLocationStore } from '@/src/stores/locationStore';
import * as ExpoLocation from 'expo-location';
import { useEffect, useMemo, useState } from 'react';

export type { HomeHotSpotData, WaterConditionsBrief };

/**
 * Loads GPS (when enabled), catalog locations, home hot spots, and regional hatch rows
 * (hatch + spot ranking load together after conditions; see {@link loadHomeHotSpotsBundle} for prefetch/cache).
 */
export function useHomeHotSpots(enabled: boolean, refreshKey: number) {
  const { locations, fetchLocations } = useLocationStore();
  const favoriteIds = useLocationFavoritesStore((s) => s.ids);
  const favoriteLocationIds = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const [hotSpotList, setHotSpotList] = useState<HomeHotSpotData[]>([]);
  const [hotSpotLoading, setHotSpotLoading] = useState(false);
  const [watersForRegionalBriefing, setWatersForRegionalBriefing] = useState<WaterConditionsBrief[]>([]);
  const [hatchRows, setHatchRows] = useState<HatchBriefRow[]>([]);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    ExpoLocation.requestForegroundPermissionsAsync()
      .then(({ status }) => {
        if (cancelled || status !== 'granted') return;
        return ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        }).then((loc) => {
          if (!cancelled) {
            setUserCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          }
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (locations.length === 0) {
      fetchLocations();
      return;
    }
    let cancelled = false;
    setHotSpotLoading(true);
    loadHomeHotSpotsBundle(locations, userCoords, favoriteLocationIds, refreshKey)
      .then((result) => {
        if (cancelled || !result) return;
        setHotSpotList(result.hotSpotList);
        setWatersForRegionalBriefing(result.watersForRegionalBriefing);
        const rows = result.hatchBriefing?.rows;
        setHatchRows(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) {
          setHotSpotList([]);
          setWatersForRegionalBriefing([]);
          setHatchRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setHotSpotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    locations,
    fetchLocations,
    refreshKey,
    userCoords?.latitude,
    userCoords?.longitude,
    favoriteLocationIds,
  ]);

  return {
    hotSpotList,
    hotSpotLoading,
    watersForRegionalBriefing,
    userCoords,
    hatchRows,
    hatchLoading: hotSpotLoading,
  };
}
