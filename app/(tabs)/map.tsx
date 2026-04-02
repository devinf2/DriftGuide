import {
    AddLocationMapSheet,
    type AddLocationMapSheetRef,
} from '@/src/components/add-location/AddLocationMapSheet';
import { TripMapboxMapView } from '@/src/components/map/TripMapboxMapView';
import { buildCatalogMapboxMarkers } from '@/src/components/map/catalogMapboxMarkers';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { MAPBOX_ACCESS_TOKEN } from '@/src/constants/mapbox';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme, type ResolvedScheme } from '@/src/theme/ThemeProvider';
import { forwardGeocode, type MapboxGeocodeFeature } from '@/src/services/mapboxGeocoding';
import { useAddLocationFlowStore } from '@/src/stores/addLocationFlowStore';
import { useLocationStore } from '@/src/stores/locationStore';
import type { Location } from '@/src/types';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';
import type { MapCameraStatePayload } from '@/src/utils/mapViewport';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as ExpoLocation from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Reserve right edge for Mapbox’s top-right compass (diameter + margin). */
const MAP_SEARCH_COMPASS_CLEARANCE = 52;

function createStyles(colors: ThemeColors, scheme: ResolvedScheme) {
  const glass = {
    idle:
      scheme === 'dark'
        ? { bg: 'rgba(30, 41, 59, 0.72)', border: 'rgba(51, 65, 85, 0.85)' }
        : { bg: 'rgba(255, 255, 255, 0.42)', border: 'rgba(226, 232, 240, 0.65)' },
    editing:
      scheme === 'dark'
        ? { bg: 'rgba(30, 41, 59, 0.88)', border: 'rgba(71, 85, 105, 0.95)' }
        : { bg: 'rgba(255, 255, 255, 0.58)', border: 'rgba(226, 232, 240, 0.85)' },
    filled:
      scheme === 'dark'
        ? { bg: 'rgba(51, 65, 85, 0.92)', border: 'rgba(100, 116, 139, 0.95)' }
        : { bg: 'rgba(255, 255, 255, 0.8)', border: 'rgba(226, 232, 240, 0.95)' },
  };
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    mapContainer: {
      ...StyleSheet.absoluteFillObject,
    },
    headerOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 2,
      paddingBottom: Spacing.sm,
    },
    headerOverlayIdle: {
      backgroundColor: 'transparent',
    },
    headerOverlayActive: {
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    searchBlock: {
      alignSelf: 'stretch',
      marginRight: MAP_SEARCH_COMPASS_CLEARANCE,
      minWidth: 0,
    },
    searchInput: {
      width: '100%',
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
      borderWidth: 1,
    },
    searchInputIdle: {
      backgroundColor: glass.idle.bg,
      borderColor: glass.idle.border,
    },
    searchInputEditingGlass: {
      backgroundColor: glass.editing.bg,
      borderColor: glass.editing.border,
    },
    searchInputFilledGlass: {
      backgroundColor: glass.filled.bg,
      borderColor: glass.filled.border,
    },
    searchInputCompact: {
      paddingVertical: 5,
      paddingHorizontal: 12,
      fontSize: FontSize.sm,
      borderRadius: BorderRadius.sm,
    },
    suggestionsPanel: {
      marginTop: Spacing.xs,
      maxHeight: 187,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
    suggestionsScroll: {
      maxHeight: 187,
    },
    suggestionsSectionLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: Spacing.sm,
      paddingTop: Spacing.xs,
      paddingBottom: 2,
    },
    suggestionsLoadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.sm,
    },
    suggestionsLoadingText: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
    },
    suggestionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: 6,
      paddingHorizontal: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderLight,
    },
    suggestionTitle: {
      flex: 1,
      fontSize: FontSize.sm,
      color: colors.text,
      fontWeight: '500',
      lineHeight: 18,
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
      color: colors.textSecondary,
      textAlign: 'center',
    },
    addLocationFab: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary,
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
}

export default function MapTabScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, resolvedScheme), [colors, resolvedScheme]);
  const { locations, fetchLocations } = useLocationStore();
  const setMapAddLocationSheetActive = useAddLocationFlowStore((s) => s.setMapSheetActive);

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
    setMapAddLocationSheetActive(addingLocation);
    return () => setMapAddLocationSheetActive(false);
  }, [addingLocation, setMapAddLocationSheetActive]);

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

  const searchAtRest =
    !searchInputFocused && searchText.trim().length === 0 && !addingLocation;
  const headerBarActive = addingLocation;

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

  const addLocationFab = useMemo(
    () => (
      <Pressable
        style={({ pressed }) => [styles.addLocationFab, pressed && styles.addLocationFabPressed]}
        onPress={() => (addingLocation ? endAddLocation() : beginAddLocation())}
        accessibilityRole="button"
        accessibilityLabel={addingLocation ? 'Cancel adding location' : 'Add location'}
      >
        <MaterialIcons name={addingLocation ? 'close' : 'add'} size={28} color={colors.textInverse} />
      </Pressable>
    ),
    [addingLocation, beginAddLocation, colors.textInverse, endAddLocation, styles],
  );

  const catalogMarkers = useMemo(
    () =>
      buildCatalogMapboxMarkers(
        locations,
        (loc) => {
          if (addingLocation) endAddLocation();
          router.push(`/spot/${loc.id}`);
        },
        {
          primary: colors.primary,
          surface: colors.surface,
          surfaceElevated: colors.surfaceElevated,
          colorScheme: resolvedScheme,
        },
      ),
    [
      locations,
      router,
      addingLocation,
      endAddLocation,
      colors.primary,
      colors.surface,
      colors.surfaceElevated,
      resolvedScheme,
    ],
  );

  const renderSuggestionRow = (key: string, title: string, onPress: () => void) => (
    <Pressable key={key} style={styles.suggestionRow} onPress={onPress}>
      <Ionicons name="location-outline" size={16} color={colors.primary} />
      <Text style={styles.suggestionTitle} numberOfLines={2}>
        {title}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <View
        style={styles.mapContainer}
        pointerEvents={mapInteractionBlocked ? 'none' : 'auto'}
      >
        {Platform.OS === 'web' ? (
          <View style={styles.webPlaceholder}>
            <MaterialIcons name="map" size={48} color={colors.textTertiary} />
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
                reservePlanTripFabSpacing
                mapTabControlLayout
              />
              {addingLocation ? (
                <View style={styles.centerPinWrap} pointerEvents="none">
                  <Ionicons name="location-sharp" size={44} color={colors.primary} style={styles.centerPinIcon} />
                </View>
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

      <View
        pointerEvents="box-none"
        style={[
          styles.headerOverlay,
          {
            paddingTop: insets.top + Spacing.sm,
            paddingLeft: Spacing.lg + insets.left,
            paddingRight: Spacing.lg + insets.right,
          },
          headerBarActive ? styles.headerOverlayActive : styles.headerOverlayIdle,
        ]}
      >
        <View style={styles.searchBlock}>
          <TextInput
            style={[
              styles.searchInput,
              searchAtRest
                ? styles.searchInputIdle
                : searchInputFocused || addingLocation
                  ? styles.searchInputEditingGlass
                  : styles.searchInputFilledGlass,
              !searchAtRest && styles.searchInputCompact,
            ]}
            placeholder={addingLocation ? 'Search map & DriftGuide…' : 'Search Locations'}
            placeholderTextColor={
              resolvedScheme === 'dark' ? '#CBD5E1' : colors.textSecondary
            }
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
                    renderSuggestionRow(`loc-${loc.id}`, loc.name, () => {
                      router.push(`/spot/${loc.id}`);
                      if (addingLocation) endAddLocation();
                      setSearchInputFocused(false);
                      Keyboard.dismiss();
                    }),
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
                    renderSuggestionRow(f.id, f.place_name, () => applyMapFeatureToMap(f)),
                  )}
                </>
              ) : null}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
