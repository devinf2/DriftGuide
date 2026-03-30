import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineRegionPickerMap } from '@/src/components/map/OfflineRegionPickerMap';
import { OfflineRegionSizeSelector } from '@/src/components/map/OfflineRegionSizeSelector';
import { DEFAULT_MAP_CENTER, USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { useMapBasemapStore } from '@/src/stores/mapBasemapStore';
import type { BoundingBox } from '@/src/types/boundingBox';
import { locationsForRoots, rootLocationIdsWithPointsInBbox } from '@/src/utils/offlineLocationSelection';
import { Colors, FontSize, Spacing, BorderRadius } from '@/src/constants/theme';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { executeOfflineRegionDownload } from '@/src/services/offlineRegionDownloadFlow';
import {
  offlineRegionHalfExtents,
  type OfflineRegionSizePreset,
} from '@/src/utils/offlineDownloadRegion';

function parseNum(v: string | undefined, fallback: number): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function OfflineRegionPickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    locationId?: string;
    centerLng?: string;
    centerLat?: string;
  }>();
  const user = useAuthStore((s) => s.user);
  const basemapId = useMapBasemapStore((s) => s.basemapId);
  const locations = useLocationStore((s) => s.locations);
  const getChildLocations = useLocationStore((s) => s.getChildLocations);

  const locationId = typeof params.locationId === 'string' ? params.locationId : undefined;
  const initialCenter = useMemo<[number, number]>(
    () => [
      parseNum(params.centerLng, DEFAULT_MAP_CENTER[0]),
      parseNum(params.centerLat, DEFAULT_MAP_CENTER[1]),
    ],
    [params.centerLng, params.centerLat],
  );

  const [liveBbox, setLiveBbox] = useState<BoundingBox | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [tileProgress, setTileProgress] = useState<number | null>(null);
  const [customSuffix] = useState(() => `${Date.now()}`);
  const [regionSizePreset, setRegionSizePreset] = useState<OfflineRegionSizePreset>('small');

  const { halfWidthKm, halfHeightKm } = useMemo(
    () => offlineRegionHalfExtents(regionSizePreset),
    [regionSizePreset],
  );

  const onRegionBboxChange = useCallback((bbox: BoundingBox, _center: [number, number]) => {
    setLiveBbox(bbox);
  }, []);

  const mapPackName = useMemo(
    () =>
      locationId
        ? `driftguide-map-${locationId}`
        : `driftguide-map-custom-${customSuffix}`,
    [locationId, customSuffix],
  );

  const storageKey = locationId ?? `offline-custom-${customSuffix}`;

  const locationsForConditions = useMemo(() => {
    if (!liveBbox) return [];
    if (locationId) {
      const primary = locations.find((l) => l.id === locationId);
      if (!primary) return [];
      return [primary, ...getChildLocations(locationId)];
    }
    const roots = rootLocationIdsWithPointsInBbox(locations, liveBbox);
    return locationsForRoots(locations, roots);
  }, [locationId, locations, getChildLocations, liveBbox]);

  const handleDownload = async () => {
    if (!user?.id) {
      Alert.alert('Sign in required', 'Sign in to download offline data.');
      return;
    }
    if (!liveBbox) {
      Alert.alert('Map loading', 'Wait for the map to finish loading, then try again.');
      return;
    }

    setDownloading(true);
    setTileProgress(null);
    try {
      const { tilesOk } = await executeOfflineRegionDownload(
        {
          userId: user.id,
          liveBbox,
          locationsForConditions,
          storageKey,
          mapPackName,
          basemapId,
        },
        (pct) => setTileProgress(pct),
      );

      const msg = tilesOk
        ? 'Map tiles and local data (conditions + catches in this area) are saved for offline use.'
        : 'Local data (conditions + catches in this area) are saved. Map tiles need a Mapbox native build to download.';
      Alert.alert('Downloaded', msg, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert('Download failed', (e as Error).message);
    } finally {
      setDownloading(false);
      setTileProgress(null);
    }
  };

  return (
    <View style={styles.root}>
      <OfflineRegionPickerMap
        key={`${regionSizePreset}-${initialCenter[0]}-${initialCenter[1]}`}
        initialCenter={initialCenter}
        initialZoom={USER_LOCATION_ZOOM}
        halfWidthKm={halfWidthKm}
        halfHeightKm={halfHeightKm}
        onRegionBboxChange={onRegionBboxChange}
      />
      <View style={[styles.footer, { paddingBottom: Spacing.lg + insets.bottom }]}>
        <OfflineRegionSizeSelector value={regionSizePreset} onChange={setRegionSizePreset} />
        {tileProgress != null && downloading ? (
          <Text style={styles.progressText}>Map tiles: {Math.round(tileProgress)}%</Text>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.downloadBtn, pressed && styles.downloadBtnPressed]}
          onPress={handleDownload}
          disabled={downloading}
        >
          {downloading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.downloadBtnText}>Download this region</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  progressText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  downloadBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  downloadBtnPressed: { opacity: 0.9 },
  downloadBtnText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: '700',
  },
});
