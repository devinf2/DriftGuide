import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  TextInput,
  FlatList,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoLocation from 'expo-location';
import { OfflineRegionPickerMap } from '@/src/components/map/OfflineRegionPickerMap';
import { OfflineRegionSizeSelector } from '@/src/components/map/OfflineRegionSizeSelector';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { DEFAULT_MAP_CENTER, USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { useLocationStore } from '@/src/stores/locationStore';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { useAuthStore } from '@/src/stores/authStore';
import { useMapBasemapStore } from '@/src/stores/mapBasemapStore';
import type { Location } from '@/src/types';
import type { BoundingBox } from '@/src/types/boundingBox';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';
import { locationsForRoots, rootLocationIdsWithPointsInBbox } from '@/src/utils/offlineLocationSelection';
import { executeOfflineRegionDownload } from '@/src/services/offlineRegionDownloadFlow';
import {
  offlineRegionHalfExtents,
  type OfflineRegionSizePreset,
} from '@/src/utils/offlineDownloadRegion';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type TabKey = 'shortcuts' | 'map';

export default function DownloadWaterwayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const user = useAuthStore((s) => s.user);
  const basemapId = useMapBasemapStore((s) => s.basemapId);
  const { isConnected } = useNetworkStatus();
  const { locations, fetchLocations } = useLocationStore();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('shortcuts');
  const [query, setQuery] = useState('');
  const [inlineMapCenter, setInlineMapCenter] = useState<[number, number]>(DEFAULT_MAP_CENTER);
  const [mapCenterVersion, setMapCenterVersion] = useState(0);
  const [liveBbox, setLiveBbox] = useState<BoundingBox | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [tileProgress, setTileProgress] = useState<number | null>(null);
  const [customSuffix] = useState(() => `${Date.now()}`);
  const [regionSizePreset, setRegionSizePreset] = useState<OfflineRegionSizePreset>('small');
  const locatedForMapTab = useRef(false);

  const { halfWidthKm, halfHeightKm } = useMemo(
    () => offlineRegionHalfExtents(regionSizePreset),
    [regionSizePreset],
  );

  useEffect(() => {
    if (isConnected) {
      fetchLocations().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [isConnected, fetchLocations]);

  useEffect(() => {
    if (tab !== 'map') {
      locatedForMapTab.current = false;
      return;
    }
    if (locatedForMapTab.current) return;
    locatedForMapTab.current = true;

    let cancelled = false;
    (async () => {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status === 'granted') {
        try {
          const pos = await ExpoLocation.getCurrentPositionAsync({});
          if (!cancelled) {
            setInlineMapCenter([pos.coords.longitude, pos.coords.latitude]);
            setMapCenterVersion((v) => v + 1);
          }
        } catch {
          /* keep default center */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tab]);

  const topLevelLocations = useMemo(
    () => activeLocationsOnly(locations).filter((l) => !l.parent_location_id),
    [locations],
  );

  const withCoords = useMemo(
    () => topLevelLocations.filter((l) => l.latitude != null && l.longitude != null),
    [topLevelLocations],
  );

  const filteredShortcuts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return withCoords;
    return withCoords.filter((l) => (l.name || '').toLowerCase().includes(q));
  }, [withCoords, query]);

  const openPickerForShortcut = useCallback(
    (loc: Location) => {
      const lat = loc.latitude!;
      const lng = loc.longitude!;
      router.push({
        pathname: '/trip/offline-region-picker',
        params: {
          locationId: loc.id,
          centerLng: String(lng),
          centerLat: String(lat),
        },
      });
    },
    [router],
  );

  const mapPackName = `driftguide-map-custom-${customSuffix}`;
  const storageKey = `offline-custom-${customSuffix}`;

  const locationsForConditions = useMemo(() => {
    if (!liveBbox) return [];
    const roots = rootLocationIdsWithPointsInBbox(locations, liveBbox);
    return locationsForRoots(locations, roots);
  }, [locations, liveBbox]);

  const onInlineRegionChange = useCallback((bbox: BoundingBox, _c: [number, number]) => {
    setLiveBbox(bbox);
  }, []);

  const handleInlineDownload = async () => {
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
        ? 'Saved for offline: map tiles plus conditions and catches in this area.'
        : 'Saved conditions and catches for this area. Map tiles need a native Mapbox build.';
      Alert.alert('Downloaded', msg, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) {
      Alert.alert('Download failed', (e as Error).message);
    } finally {
      setDownloading(false);
      setTileProgress(null);
    }
  };

  if (!isConnected) {
    return (
      <View style={[styles.container, { paddingTop: effectiveTop + Spacing.xl }]}>
        <Text style={styles.offlineMessage}>
          Connect to the internet to add regions for offline use.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.outer, { paddingTop: Spacing.md }]}>
      <View style={styles.padded}>
        <Text style={[styles.subtitle, tab === 'map' && styles.subtitleMapTab]}>
          Save the highlighted area for offline—map, conditions, and catches. Pan and zoom to move
          it.
        </Text>
        {tab === 'shortcuts' ? (
          <Text style={styles.subtitleHint}>Or search and open a waterway to start there.</Text>
        ) : null}

        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tab, tab === 'shortcuts' && styles.tabActive]}
            onPress={() => setTab('shortcuts')}
          >
            <Text style={[styles.tabText, tab === 'shortcuts' && styles.tabTextActive]}>Shortcuts</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, tab === 'map' && styles.tabActive]}
            onPress={() => setTab('map')}
          >
            <Text style={[styles.tabText, tab === 'map' && styles.tabTextActive]}>Map</Text>
          </Pressable>
        </View>
      </View>

      {tab === 'shortcuts' ? (
        <View style={[styles.shortcutsBody, styles.padded]}>
          <TextInput
            style={styles.search}
            placeholder="Search waterways…"
            placeholderTextColor={Colors.textTertiary}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {loading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.xxl }} />
          ) : filteredShortcuts.length === 0 ? (
            <Text style={styles.empty}>
              {withCoords.length === 0
                ? 'No locations with map coordinates. Pull to refresh on the home screen, then try again.'
                : 'No matches. Try a different search.'}
            </Text>
          ) : (
            <FlatList
              style={styles.list}
              data={filteredShortcuts}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => openPickerForShortcut(item)}>
                  <MaterialCommunityIcons name="water" size={22} color={Colors.primary} />
                  <Text style={styles.rowName}>{item.name}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={22} color={Colors.textTertiary} />
                </Pressable>
              )}
            />
          )}
        </View>
      ) : (
        <View style={styles.mapColumn}>
          <View style={styles.mapColumnPadded}>
            <OfflineRegionSizeSelector value={regionSizePreset} onChange={setRegionSizePreset} />
          </View>
          <OfflineRegionPickerMap
            key={`${inlineMapCenter[0]}-${inlineMapCenter[1]}-v${mapCenterVersion}-${regionSizePreset}`}
            initialCenter={inlineMapCenter}
            initialZoom={USER_LOCATION_ZOOM}
            halfWidthKm={halfWidthKm}
            halfHeightKm={halfHeightKm}
            onRegionBboxChange={onInlineRegionChange}
          />
          <View style={[styles.mapFooter, { paddingBottom: Spacing.md + insets.bottom }]}>
            {tileProgress != null && downloading ? (
              <Text style={styles.progressText}>Map tiles: {Math.round(tileProgress)}%</Text>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.downloadBtn, pressed && styles.downloadBtnPressed]}
              onPress={handleInlineDownload}
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: Colors.background },
  padded: { paddingHorizontal: Spacing.xl },
  container: { backgroundColor: Colors.background, paddingHorizontal: Spacing.xl },
  shortcutsBody: { flex: 1 },
  list: { flex: 1 },
  subtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.xs },
  subtitleMapTab: { marginBottom: Spacing.md },
  subtitleHint: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginBottom: Spacing.lg,
  },
  offlineMessage: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', padding: Spacing.xl },
  tabRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  tabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tabText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: '#fff' },
  search: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.md,
  },
  listContent: { paddingBottom: Spacing.xxl },
  empty: { fontSize: FontSize.sm, color: Colors.textTertiary, textAlign: 'center', paddingVertical: Spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
  },
  rowName: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  mapColumn: { flex: 1 },
  mapColumnPadded: { paddingHorizontal: Spacing.xl },
  mapFooter: {
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
