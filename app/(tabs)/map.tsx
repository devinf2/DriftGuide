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
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as ExpoLocation from 'expo-location';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { MAPBOX_ACCESS_TOKEN } from '@/src/constants/mapbox';
import { useLocationStore } from '@/src/stores/locationStore';
import type { Location } from '@/src/types';
import { forwardGeocode, type MapboxGeocodeFeature } from '@/src/services/mapboxGeocoding';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';
import { TripMapboxMapView } from '@/src/components/map/TripMapboxMapView';
import { buildCatalogMapboxMarkers } from '@/src/components/map/catalogMapboxMarkers';
import {
  AddLocationMapSheet,
  type AddLocationMapSheetRef,
} from '@/src/components/add-location/AddLocationMapSheet';
import type { MapCameraStatePayload } from '@/src/utils/mapViewport';

export default function MapTabScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { locations, fetchLocations } = useLocationStore();

  const mapSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const userProximityRef = useRef<[number, number] | null>(null);
  const addLocationSheetRef = useRef<AddLocationMapSheetRef | null>(null);

  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_MAP_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_MAP_ZOOM);
  const [cameraNonce, setCameraNonce] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [mapSuggestions, setMapSuggestions] = useState<MapboxGeocodeFeature[]>([]);
  const [mapSuggestionsLoading, setMapSuggestionsLoading] = useState(false);
  /** Latest fix for “recenter on me” (Mapbox user puck is separate). */
  const [userLngLat, setUserLngLat] = useState<[number, number] | null>(null);
  const [locationAllowed, setLocationAllowed] = useState(false);
  const [addingLocation, setAddingLocation] = useState(false);
  const [addPin, setAddPin] = useState<{ latitude: number; longitude: number }>({
    latitude: DEFAULT_MAP_CENTER[1],
    longitude: DEFAULT_MAP_CENTER[0],
  });
  const [mapInteractionBlocked, setMapInteractionBlocked] = useState(false);
  /** Snapshot of search bar when add mode opens — seeds the Name field once per open. */
  const [addLocationSearchSeed, setAddLocationSearchSeed] = useState('');
  /** Bottom sheet height — map stage uses this as marginBottom so the map center matches the crosshair. */
  const [addSheetHeight, setAddSheetHeight] = useState(300);

  useFocusEffect(
    useCallback(() => {
      if (locations.length === 0) void fetchLocations();
    }, [locations.length, fetchLocations]),
  );

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
        setUserLngLat([longitude, latitude]);
        setMapCenter([longitude, latitude]);
        setMapZoom(USER_LOCATION_ZOOM);
        setCameraNonce((n) => n + 1);
      } catch {
        /* keep DEFAULT_MAP_CENTER */
      }

      subscription = await ExpoLocation.watchPositionAsync(
        {
          accuracy: ExpoLocation.Accuracy.Balanced,
          distanceInterval: 15,
        },
        (loc) => {
          const { latitude, longitude } = loc.coords;
          userProximityRef.current = [longitude, latitude];
          setUserLngLat([longitude, latitude]);
        },
      );
    })();

    return () => {
      subscription?.remove();
    };
  }, []);

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

  const beginAddLocation = useCallback(() => {
    const [lng, lat] = mapCenter;
    setAddPin({ latitude: lat, longitude: lng });
    setAddLocationSearchSeed(searchText);
    setAddingLocation(true);
  }, [mapCenter, searchText]);

  const endAddLocation = useCallback(() => {
    setAddingLocation(false);
    Keyboard.dismiss();
  }, []);

  const handleMapIdleWhileAdding = useCallback((state: MapCameraStatePayload) => {
    const [lng, lat] = state.properties.center;
    setAddPin({ latitude: lat, longitude: lng });
  }, []);

  const applyMapFeatureToMap = useCallback(
    (f: MapboxGeocodeFeature) => {
      const [lng, lat] = f.center;
      setSearchText(f.place_name);
      if (addingLocation) {
        addLocationSheetRef.current?.syncNameFromMapFeature(f.place_name);
        setAddPin({ latitude: lat, longitude: lng });
      }
      setMapCenter([lng, lat]);
      setMapZoom(USER_LOCATION_ZOOM);
      setCameraNonce((n) => n + 1);
      setSearchInputFocused(false);
      Keyboard.dismiss();
    },
    [addingLocation],
  );

  const goToUserLocation = useCallback(() => {
    if (!userLngLat) return;
    setMapCenter(userLngLat);
    setMapZoom(USER_LOCATION_ZOOM);
    setCameraNonce((n) => n + 1);
  }, [userLngLat]);

  const addLocationFab = useMemo(
    () => (
      <Pressable
        style={({ pressed }) => [styles.addLocationFab, pressed && styles.addLocationFabPressed]}
        onPress={() => (addingLocation ? endAddLocation() : beginAddLocation())}
        accessibilityRole="button"
        accessibilityLabel={addingLocation ? 'Cancel adding location' : 'Add location'}
      >
        <MaterialIcons name={addingLocation ? 'close' : 'add'} size={28} color={Colors.textInverse} />
      </Pressable>
    ),
    [addingLocation, beginAddLocation, endAddLocation],
  );

  const catalogMarkers = useMemo(
    () =>
      buildCatalogMapboxMarkers(locations, (loc) => {
        if (addingLocation) endAddLocation();
        router.push(`/spot/${loc.id}`);
      }),
    [locations, router, addingLocation, endAddLocation],
  );

  const renderSuggestionRow = (
    key: string,
    title: string,
    subtitle: string | null,
    onPress: () => void,
  ) => (
    <Pressable key={key} style={styles.suggestionRow} onPress={onPress}>
      <Ionicons name="location-outline" size={20} color={Colors.primary} />
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
      <View
        style={[
          styles.headerStrip,
          {
            paddingTop: insets.top + Spacing.sm,
            paddingLeft: Spacing.lg + insets.left,
            paddingRight: Spacing.lg + insets.right,
          },
        ]}
      >
        <TextInput
          style={styles.searchInput}
          placeholder={addingLocation ? 'Search map & DriftGuide…' : 'Search Locations'}
          placeholderTextColor={Colors.textTertiary}
          value={searchText}
          onChangeText={(text) => {
            setSearchText(text);
            if (addingLocation) {
              addLocationSheetRef.current?.syncNameFromSearch(text);
            }
          }}
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
                      addingLocation ? 'Use existing location' : 'Open location',
                      () => {
                        router.push(`/spot/${loc.id}`);
                        if (addingLocation) endAddLocation();
                        setSearchInputFocused(false);
                        Keyboard.dismiss();
                      },
                    ),
                  )}
                </>
              ) : null}
              {mapSuggestionsLoading ? (
                <View style={styles.suggestionsLoadingRow}>
                  <ActivityIndicator size="small" color={Colors.primary} />
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

      <View
        style={styles.mapContainer}
        pointerEvents={mapInteractionBlocked ? 'none' : 'auto'}
      >
        {Platform.OS === 'web' ? (
          <View style={styles.webPlaceholder}>
            <MaterialIcons name="map" size={48} color={Colors.textTertiary} />
            <Text style={styles.webPlaceholderText}>Map is available in the iOS and Android app.</Text>
          </View>
        ) : (
          <>
            <View
              style={[
                styles.mapStage,
                addingLocation ? { marginBottom: addSheetHeight } : null,
              ]}
            >
              <TripMapboxMapView
                containerStyle={styles.map}
                centerCoordinate={mapCenter}
                zoomLevel={mapZoom}
                cameraKey={`map-tab-${cameraNonce}`}
                markers={catalogMarkers}
                showUserLocation={locationAllowed}
                onMapIdle={addingLocation ? handleMapIdleWhileAdding : undefined}
                onZoomLevelChange={setMapZoom}
                trailingFab={addLocationFab}
              />
              {addingLocation ? (
                <View style={styles.centerPinWrap} pointerEvents="none">
                  <Ionicons name="location-sharp" size={44} color={Colors.primary} style={styles.centerPinIcon} />
                </View>
              ) : null}
              {userLngLat && locationAllowed ? (
                <Pressable
                  style={[
                    styles.recenterButton,
                    {
                      bottom: addingLocation
                        ? Spacing.lg + 44 + Spacing.sm
                        : Spacing.lg + 44 + Spacing.sm + 88,
                    },
                  ]}
                  onPress={goToUserLocation}
                  accessibilityRole="button"
                  accessibilityLabel="Center map on my location"
                >
                  <Ionicons name="locate" size={22} color={Colors.primary} />
                </Pressable>
              ) : null}
            </View>
            <AddLocationMapSheet
              ref={addLocationSheetRef}
              visible={addingLocation}
              initialSearchText={addLocationSearchSeed}
              pinLatitude={addPin.latitude}
              pinLongitude={addPin.longitude}
              onRequestClose={endAddLocation}
              onSheetHeightChange={setAddSheetHeight}
              onMapInteractionBlockedChange={setMapInteractionBlocked}
              onSaved={(id) => {
                router.push(`/spot/${id}`);
                endAddLocation();
              }}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerStrip: {
    backgroundColor: Colors.surface,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    zIndex: 2,
  },
  searchInput: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  suggestionsPanel: {
    marginTop: Spacing.sm,
    maxHeight: 200,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
  },
  suggestionsScroll: {
    maxHeight: 200,
  },
  suggestionsSectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textTertiary,
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
    color: Colors.textTertiary,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  suggestionTextBlock: {
    flex: 1,
  },
  suggestionTitle: {
    fontSize: FontSize.md,
    color: Colors.text,
    fontWeight: '500',
  },
  suggestionSubtitle: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  mapContainer: {
    flex: 1,
  },
  mapStage: {
    flex: 1,
    minHeight: 0,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  centerPinWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerPinIcon: {
    marginBottom: 26,
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
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  recenterButton: {
    position: 'absolute',
    left: Spacing.md,
    borderRadius: 22,
    width: 44,
    height: 44,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  addLocationFab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  addLocationFabPressed: {
    opacity: 0.88,
  },
});
