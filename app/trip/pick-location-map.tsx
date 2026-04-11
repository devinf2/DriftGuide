import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as ExpoLocation from 'expo-location';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { MAPBOX_ACCESS_TOKEN } from '@/src/constants/mapbox';
import { useLocationFavoritesStore } from '@/src/stores/locationFavoritesStore';
import { useLocationStore } from '@/src/stores/locationStore';
import type { Location } from '@/src/types';
import { forwardGeocode, type MapboxGeocodeFeature } from '@/src/services/mapboxGeocoding';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';
import { TripMapboxMapView } from '@/src/components/map/TripMapboxMapView';
import { buildCatalogMapboxMarkers } from '@/src/components/map/catalogMapboxMarkers';

function parseCoordParam(s: string | undefined): number {
  if (s == null || s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Full catalog map (same markers/search as the Map tab) for choosing a saved location
 * when planning a trip. Opens the spot overview; confirming uses {@link useLocationStore.setPendingPlanTripLocationId}.
 */
export default function PickLocationMapScreen() {
  const { colors, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createPickLocationStyles(colors), [colors]);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const params = useLocalSearchParams<{ presetName?: string; lat?: string; lng?: string }>();
  const presetLat = parseCoordParam(params.lat);
  const presetLng = parseCoordParam(params.lng);
  const hasPresetMapCoords = Number.isFinite(presetLat) && Number.isFinite(presetLng);

  const { locations, fetchLocations } = useLocationStore();
  const favoriteIds = useLocationFavoritesStore((s) => s.ids);
  const favoriteLocationIds = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const mapSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const userProximityRef = useRef<[number, number] | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_MAP_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_MAP_ZOOM);
  const [cameraNonce, setCameraNonce] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [mapSuggestions, setMapSuggestions] = useState<MapboxGeocodeFeature[]>([]);
  const [mapSuggestionsLoading, setMapSuggestionsLoading] = useState(false);
  const [locationAllowed, setLocationAllowed] = useState(false);

  const chooseLocation = useCallback((loc: Location) => {
    Keyboard.dismiss();
    router.push(`/spot/${loc.id}?planTripPicker=1&fromMap=1`);
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      if (locations.length === 0) void fetchLocations();
    }, [locations.length, fetchLocations]),
  );

  useEffect(() => {
    const raw = params.presetName;
    if (raw == null || String(raw).trim() === '') return;
    const decoded = (() => {
      try {
        return decodeURIComponent(String(raw)).trim();
      } catch {
        return String(raw).trim();
      }
    })();
    if (decoded) setSearchText(decoded);
  }, [params.presetName]);

  useEffect(() => {
    if (!hasPresetMapCoords) return;
    setMapCenter([presetLng, presetLat]);
    setMapZoom(USER_LOCATION_ZOOM);
    userProximityRef.current = [presetLng, presetLat];
    setCameraNonce((n) => n + 1);
  }, [hasPresetMapCoords, presetLat, presetLng]);

  useEffect(() => {
    let subscription: ExpoLocation.LocationSubscription | undefined;
    (async () => {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      setLocationAllowed(true);
      try {
        const loc = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        const { latitude, longitude } = loc.coords;
        userProximityRef.current = [longitude, latitude];
        if (!hasPresetMapCoords) {
          setMapCenter([longitude, latitude]);
          setMapZoom(USER_LOCATION_ZOOM);
          setCameraNonce((n) => n + 1);
        }
      } catch {
        /* keep DEFAULT_MAP_CENTER or preset */
      }

      subscription = await ExpoLocation.watchPositionAsync(
        {
          accuracy: ExpoLocation.Accuracy.Balanced,
          distanceInterval: 15,
        },
        (loc) => {
          const { latitude, longitude } = loc.coords;
          userProximityRef.current = [longitude, latitude];
        },
      );
    })();

    return () => {
      subscription?.remove();
    };
  }, [hasPresetMapCoords]);

  useEffect(() => {
    const q = searchText.trim();
    if (!searchInputFocused || q.length < 2) {
      setMapSuggestions([]);
      setMapSuggestionsLoading(false);
      return;
    }
    if (!MAPBOX_ACCESS_TOKEN) {
      setMapSuggestions([]);
      setMapSuggestionsLoading(false);
      return;
    }
    clearTimeout(mapSearchDebounceRef.current);
    mapSearchDebounceRef.current = setTimeout(async () => {
      setMapSuggestionsLoading(true);
      try {
        const proximity = userProximityRef.current ?? undefined;
        const { features } = await forwardGeocode(q, { proximity, limit: 5 });
        setMapSuggestions(features);
      } catch {
        setMapSuggestions([]);
      } finally {
        setMapSuggestionsLoading(false);
      }
    }, 380);
    return () => clearTimeout(mapSearchDebounceRef.current);
  }, [searchText, searchInputFocused]);

  const savedLocationMatches = useMemo(
    () =>
      searchText.trim().length >= 2
        ? filterLocationsByQuery(activeLocationsOnly(locations), searchText)
        : [],
    [locations, searchText],
  );

  const showSearchSuggestions =
    searchInputFocused &&
    searchText.trim().length >= 2 &&
    (mapSuggestionsLoading || mapSuggestions.length > 0 || savedLocationMatches.length > 0);

  const applyMapFeatureToMap = useCallback((f: MapboxGeocodeFeature) => {
    const [lng, lat] = f.center;
    setSearchText(f.place_name);
    setMapCenter([lng, lat]);
    setMapZoom(USER_LOCATION_ZOOM);
    setCameraNonce((n) => n + 1);
    setSearchInputFocused(false);
    Keyboard.dismiss();
  }, []);

  const catalogMarkers = useMemo(
    () =>
      buildCatalogMapboxMarkers(locations, chooseLocation, {
        primary: colors.primary,
        surface: colors.surface,
        surfaceElevated: colors.surfaceElevated,
        colorScheme: resolvedScheme,
      }, favoriteLocationIds),
    [
      locations,
      chooseLocation,
      colors.primary,
      colors.surface,
      colors.surfaceElevated,
      resolvedScheme,
      favoriteLocationIds,
    ],
  );

  const renderSuggestionRow = (
    key: string,
    title: string,
    subtitle: string | null,
    onPress: () => void,
  ) => (
    <Pressable key={key} style={styles.suggestionRow} onPress={onPress}>
      <Ionicons name="location-outline" size={20} color={colors.primary} />
      <View style={styles.suggestionTextBlock}>
        <Text style={styles.suggestionTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.suggestionSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={[styles.planHeaderBar, { paddingTop: effectiveTop }]}>
        <View style={[styles.planHeaderSide, styles.planHeaderSideStart]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              marginLeft: 8,
              paddingVertical: Spacing.sm,
              paddingRight: Spacing.sm,
              opacity: pressed ? 0.65 : 1,
            })}
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={22} color={colors.textInverse} style={styles.planHeaderBackIcon} />
            <Text style={styles.planHeaderBackText}>Back</Text>
          </Pressable>
        </View>
        <Text style={styles.planHeaderTitle} numberOfLines={1}>
          Choose location
        </Text>
        <View style={styles.planHeaderSide} />
      </View>

      <View
        style={[
          styles.headerStrip,
          {
            paddingTop: Spacing.sm,
            paddingLeft: Spacing.lg + insets.left,
            paddingRight: Spacing.lg + insets.right,
          },
        ]}
      >
        <TextInput
          style={styles.searchInput}
          placeholder="Search locations"
          placeholderTextColor={colors.textTertiary}
          value={searchText}
          onChangeText={setSearchText}
          onFocus={() => setSearchInputFocused(true)}
          onBlur={() => {
            setTimeout(() => setSearchInputFocused(false), 200);
          }}
          returnKeyType="done"
        />
        {showSearchSuggestions ? (
          <View style={styles.suggestionsPanel}>
            <ScrollView
              style={styles.suggestionsScroll}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {savedLocationMatches.length > 0 ? (
                <>
                  <Text style={styles.suggestionsSectionLabel}>In DriftGuide</Text>
                  {savedLocationMatches.slice(0, 8).map((loc: Location) =>
                    renderSuggestionRow(
                      `loc-${loc.id}`,
                      loc.name,
                      'Use for this trip',
                      () => {
                        chooseLocation(loc);
                        setSearchInputFocused(false);
                        Keyboard.dismiss();
                      },
                    ),
                  )}
                </>
              ) : null}
              {mapSuggestionsLoading ? (
                <View style={styles.suggestionsLoadingRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.suggestionsLoadingText}>Searching map near you…</Text>
                </View>
              ) : null}
              {!mapSuggestionsLoading && mapSuggestions.length > 0 ? (
                <>
                  <Text style={styles.suggestionsSectionLabel}>Map suggestions</Text>
                  {mapSuggestions.map((f) =>
                    renderSuggestionRow(f.id, f.place_name, 'Move map here', () =>
                      applyMapFeatureToMap(f),
                    ),
                  )}
                </>
              ) : null}
            </ScrollView>
          </View>
        ) : null}
      </View>

      <View style={styles.mapContainer}>
        {Platform.OS === 'web' ? (
          <View style={styles.webPlaceholder}>
            <Ionicons name="map-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.webPlaceholderText}>Map is available in the iOS and Android app.</Text>
          </View>
        ) : (
          <TripMapboxMapView
            containerStyle={styles.map}
            centerCoordinate={mapCenter}
            zoomLevel={mapZoom}
            cameraKey={`pick-loc-map-${cameraNonce}`}
            markers={catalogMarkers}
            showUserLocation={locationAllowed}
            onZoomLevelChange={setMapZoom}
          />
        )}
      </View>
    </View>
  );
}

function createPickLocationStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  planHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  planHeaderSide: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  planHeaderSideStart: {
    alignItems: 'flex-start',
  },
  planHeaderTitle: {
    flexShrink: 1,
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: colors.textInverse,
    textAlign: 'center',
  },
  planHeaderBackIcon: {
    marginLeft: -4,
  },
  planHeaderBackText: {
    fontSize: FontSize.md,
    color: colors.textInverse,
    fontWeight: '400',
  },
  headerStrip: {
    backgroundColor: colors.surface,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    zIndex: 2,
  },
  searchInput: {
    backgroundColor: colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  suggestionsPanel: {
    marginTop: Spacing.sm,
    maxHeight: 200,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  suggestionsScroll: {
    maxHeight: 200,
  },
  suggestionsSectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  suggestionsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  suggestionsLoadingText: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  suggestionTextBlock: {
    flex: 1,
  },
  suggestionTitle: {
    fontSize: FontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  suggestionSubtitle: {
    fontSize: FontSize.xs,
    color: colors.textTertiary,
    marginTop: 2,
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  webPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  webPlaceholderText: {
    marginTop: Spacing.md,
    fontSize: FontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  });
}
