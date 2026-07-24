import { AddPlaceSheet } from '@/src/components/add-location/AddPlaceSheet';
import { LandOwnershipSheet } from '@/src/components/map/LandOwnershipSheet';
import {
  TripMapboxMapView,
  type TripMapboxMapRef,
  type MapboxMapMarker,
} from '@/src/components/map/TripMapboxMapView';
import { buildCatalogMapboxMarkers } from '@/src/components/map/catalogMapboxMarkers';
import { buildBusinessMapboxMarkers } from '@/src/components/map/businessMapboxMarkers';
import { useBusinessStore } from '@/src/stores/businessStore';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { MAPBOX_ACCESS_TOKEN } from '@/src/constants/mapbox';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme, type ResolvedScheme } from '@/src/theme/ThemeProvider';
import { forwardGeocode, type MapboxGeocodeFeature } from '@/src/services/mapboxGeocoding';
import { useAddLocationFlowStore } from '@/src/stores/addLocationFlowStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { useMapOverlayStore } from '@/src/stores/mapOverlayStore';
import { getLandOwnershipAtPoint } from '@/src/services/landOwnershipService';
import type { Business, LandOwnershipInfo, Location } from '@/src/types';
import { isPointInBoundingBox, type BoundingBox } from '@/src/types/boundingBox';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';
import { boundingBoxFromMapState, type MapCameraStatePayload } from '@/src/utils/mapViewport';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as ExpoLocation from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
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
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationFavoritesStore } from '@/src/stores/locationFavoritesStore';
import { loadOfflineLocationsSnapshot } from '@/src/services/offlineLocationSnapshot';
import { mergeLocationsById } from '@/src/utils/mergeLocations';

/** Reserve right edge for Mapbox’s top-right compass (diameter + margin). */
const MAP_SEARCH_COMPASS_CLEARANCE = 52;
/** Max catalog pins painted at once; the in-view set is evenly sampled down to this. */
const MAX_CATALOG_PINS = 80;
/** Below this zoom the map is too far out to place pins usefully — hide them entirely. */
const MIN_CATALOG_PIN_ZOOM = 6;

function catalogPinCoords(loc: Location, catalog: Location[]): { lat: number; lng: number } | null {
  if (
    loc.latitude != null &&
    loc.longitude != null &&
    Number.isFinite(loc.latitude) &&
    Number.isFinite(loc.longitude)
  ) {
    return { lat: loc.latitude, lng: loc.longitude };
  }
  if (loc.parent_location_id) {
    const parent = catalog.find((l) => l.id === loc.parent_location_id);
    if (
      parent?.latitude != null &&
      parent?.longitude != null &&
      Number.isFinite(parent.latitude) &&
      Number.isFinite(parent.longitude)
    ) {
      return { lat: parent.latitude, lng: parent.longitude };
    }
  }
  return null;
}

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
    addPinMarker: {
      alignItems: 'center',
      justifyContent: 'center',
      // Anchor the pin's tip on the coordinate (MarkerView centers by default).
      marginBottom: 40,
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
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
    layerChipsRow: {
      flexDirection: 'row',
      gap: Spacing.xs,
      marginTop: Spacing.sm,
    },
    layerChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 5,
      borderRadius: BorderRadius.full,
      borderWidth: 1,
    },
    layerChipOn: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    layerChipOff: {
      backgroundColor: glass.filled.bg,
      borderColor: glass.filled.border,
    },
    layerChipTextOn: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.textInverse,
    },
    layerChipTextOff: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.text,
    },
  });
}

export default function MapTabScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const { isConnected } = useNetworkStatus();
  const user = useAuthStore((s) => s.user);
  const favoriteIds = useLocationFavoritesStore((s) => s.ids);
  const favoriteLocationIds = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const { colors, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, resolvedScheme), [colors, resolvedScheme]);
  const { locations, fetchLocations } = useLocationStore();
  const [offlineSnap, setOfflineSnap] = useState<Location[]>([]);
  const setMapAddLocationSheetActive = useAddLocationFlowStore((s) => s.setMapSheetActive);
  const businesses = useBusinessStore((s) => s.businesses);
  const fetchBusinesses = useBusinessStore((s) => s.fetchAll);
  const showBusinessesOnMap = useBusinessStore((s) => s.showOnMap);
  const setShowBusinessesOnMap = useBusinessStore((s) => s.setShowOnMap);
  const [showSpotsOnMap, setShowSpotsOnMap] = useState(true);

  const mapSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const userProximityRef = useRef<[number, number] | null>(null);
  const geocodeProximityRef = useRef<[number, number] | null>(null);
  /** Bias for Mapbox geocode (add-location sheet + top bar); mirrored from GPS watch. */
  const [geocodeProximity, setGeocodeProximity] = useState<[number, number] | null>(null);

  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_MAP_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_MAP_ZOOM);
  const [mapViewport, setMapViewport] = useState<BoundingBox | null>(null);
  const [cameraNonce, setCameraNonce] = useState(0);
  const mapRef = useRef<TripMapboxMapRef | null>(null);
  const [searchText, setSearchText] = useState('');
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [mapSuggestions, setMapSuggestions] = useState<MapboxGeocodeFeature[]>([]);
  const [mapSuggestionsLoading, setMapSuggestionsLoading] = useState(false);
  const [locationAllowed, setLocationAllowed] = useState(false);
  // Single add-mode: long-press the map to enter it and drop a pin. Once a pin is placed
  // (`addMode && pinPlaced`), `AddPlaceSheet` takes over — showing the type rail, then the
  // matching form (water / access point / parking / business).
  const [addMode, setAddMode] = useState(false);
  const [pinPlaced, setPinPlaced] = useState(false);
  const anyAdding = addMode;
  const [addPin, setAddPin] = useState<{ latitude: number; longitude: number }>({
    latitude: DEFAULT_MAP_CENTER[1],
    longitude: DEFAULT_MAP_CENTER[0],
  });
  const [mapInteractionBlocked, setMapInteractionBlocked] = useState(false);
  /** Bottom sheet height — map stage uses this as marginBottom so the map center matches the crosshair. */
  const [addSheetHeight, setAddSheetHeight] = useState(300);

  // Public / Private Land overlay + tap-to-inspect sheet.
  const landOwnershipVisible = useMapOverlayStore((s) => s.landOwnershipVisible);
  const [landSheetOpen, setLandSheetOpen] = useState(false);
  const [landLoading, setLandLoading] = useState(false);
  const [landInfo, setLandInfo] = useState<LandOwnershipInfo | null>(null);

  useEffect(() => {
    if (!landOwnershipVisible) {
      setLandSheetOpen(false);
      setLandInfo(null);
    }
  }, [landOwnershipVisible]);

  const handleLandMapPress = useCallback(async (coordinate: [number, number]) => {
    const [lng, lat] = coordinate;
    setLandInfo(null);
    setLandLoading(true);
    setLandSheetOpen(true);
    const info = await getLandOwnershipAtPoint(lng, lat);
    setLandInfo(info);
    setLandLoading(false);
    if (!info) setLandSheetOpen(false); // tap outside any ownership polygon → nothing to show
  }, []);

  const closeLandSheet = useCallback(() => {
    setLandSheetOpen(false);
    setLandInfo(null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (locations.length === 0) void fetchLocations();
      void fetchBusinesses();
    }, [locations.length, fetchLocations, fetchBusinesses]),
  );

  useEffect(() => {
    if (isConnected || !user?.id) {
      setOfflineSnap([]);
      return;
    }
    void loadOfflineLocationsSnapshot(user.id).then(setOfflineSnap);
  }, [isConnected, user?.id]);

  useEffect(() => {
    geocodeProximityRef.current = geocodeProximity;
  }, [geocodeProximity]);

  const mapDisplayLocations = useMemo(
    () => mergeLocationsById(locations, offlineSnap),
    [locations, offlineSnap],
  );

  useEffect(() => {
    setMapAddLocationSheetActive(anyAdding);
    return () => setMapAddLocationSheetActive(false);
  }, [anyAdding, setMapAddLocationSheetActive]);

  // Safety net: never leave the map's touch-blocking overlay on once we exit add-mode.
  useEffect(() => {
    if (!anyAdding) setMapInteractionBlocked(false);
  }, [anyAdding]);

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
        const pair: [number, number] = [longitude, latitude];
        userProximityRef.current = pair;
        setGeocodeProximity(pair);
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
          const pair: [number, number] = [longitude, latitude];
          userProximityRef.current = pair;
          setGeocodeProximity(pair);
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
        const proximity = geocodeProximityRef.current ?? userProximityRef.current ?? undefined;
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
        ? filterLocationsByQuery(activeLocationsOnly(mapDisplayLocations), searchText)
        : [],
    [mapDisplayLocations, searchText],
  );

  const showSearchSuggestions =
    searchInputFocused &&
    searchText.trim().length >= 2 &&
    (mapSuggestionsLoading || mapSuggestions.length > 0 || savedLocationMatches.length > 0);

  const searchAtRest = !searchInputFocused && searchText.trim().length === 0;

  /** Long-press the map to start adding: drops the pin and opens the sheet in one gesture. */
  const handleMapLongPress = useCallback((coordinate: [number, number]) => {
    const [lng, lat] = coordinate;
    setAddPin({ latitude: lat, longitude: lng });
    setAddMode(true);
    setPinPlaced(true);
  }, []);

  /** While already adding, tapping the map moves the pin. */
  const handleAddModeMapPress = useCallback((coordinate: [number, number]) => {
    const [lng, lat] = coordinate;
    setAddPin({ latitude: lat, longitude: lng });
    setPinPlaced(true);
  }, []);

  const jumpMapToGeocodeFeature = useCallback((f: MapboxGeocodeFeature) => {
    const [lng, lat] = f.center;
    mapRef.current?.easeToCenter([lng, lat], USER_LOCATION_ZOOM);
    setMapCenter([lng, lat]);
    setMapZoom(USER_LOCATION_ZOOM);
    setAddPin({ latitude: lat, longitude: lng });
    setPinPlaced(true);
  }, []);

  const endAddLocation = useCallback(() => {
    setAddMode(false);
    setPinPlaced(false);
    // The sheet can unmount mid-save before its effect sends `false` back, which would
    // otherwise leave the map's pointerEvents stuck at "none" (frozen). Clear it here.
    setMapInteractionBlocked(false);
    Keyboard.dismiss();
  }, []);

  /** While adding, picking a map search result flies there AND drops the pin. */
  const pickMapSuggestionWhileAdding = useCallback(
    (f: MapboxGeocodeFeature) => {
      setSearchText(f.place_name);
      setSearchInputFocused(false);
      jumpMapToGeocodeFeature(f);
      Keyboard.dismiss();
    },
    [jumpMapToGeocodeFeature],
  );

  const handleMapIdle = useCallback((state: MapCameraStatePayload) => {
    setMapViewport(boundingBoxFromMapState(state));
  }, []);

  const applyMapFeatureToMap = useCallback((f: MapboxGeocodeFeature) => {
    const [lng, lat] = f.center;
    mapRef.current?.easeToCenter([lng, lat], USER_LOCATION_ZOOM);
    setSearchText(f.place_name);
    setMapCenter([lng, lat]);
    setMapZoom(USER_LOCATION_ZOOM);
    setSearchInputFocused(false);
    Keyboard.dismiss();
  }, []);

  const jumpMapToCatalogLocationWhileAdding = useCallback(
    (loc: Location) => {
      const c = catalogPinCoords(loc, mapDisplayLocations);
      if (!c) {
        Alert.alert(
          'No map position',
          'This place has no coordinates in DriftGuide yet. Pan the map or pick a map suggestion instead.',
        );
        return;
      }
      mapRef.current?.easeToCenter([c.lng, c.lat], USER_LOCATION_ZOOM);
      setMapCenter([c.lng, c.lat]);
      setMapZoom(USER_LOCATION_ZOOM);
      setAddPin({ latitude: c.lat, longitude: c.lng });
      setPinPlaced(true);
      Keyboard.dismiss();
    },
    [mapDisplayLocations],
  );

  // Cap how many catalog pins we draw at once. The full catalog is national (~700+),
  // and rendering every MarkerView leaves no bare map to grab and bogs down the GL
  // surface. Keep only what's in view; if that's still too many, evenly sample it so
  // coverage stays uniform at any zoom. Search and the add-location sheet still use the
  // full list (mapDisplayLocations) — this only thins what's painted on the map.
  const visibleCatalogLocations = useMemo(() => {
    // Too far out to be useful (and just a wall of icons) — show nothing until zoomed in.
    if (mapZoom < MIN_CATALOG_PIN_ZOOM) return [];
    const inView = mapViewport
      ? mapDisplayLocations.filter(
          (l) =>
            l.latitude != null &&
            l.longitude != null &&
            isPointInBoundingBox(l.latitude, l.longitude, mapViewport),
        )
      : mapDisplayLocations;
    if (inView.length <= MAX_CATALOG_PINS) return inView;
    const stride = Math.ceil(inView.length / MAX_CATALOG_PINS);
    return inView.filter((_, i) => i % stride === 0);
  }, [mapDisplayLocations, mapViewport, mapZoom]);

  const catalogMarkers = useMemo(
    () =>
      buildCatalogMapboxMarkers(
        visibleCatalogLocations,
        (loc) => {
          if (addMode) endAddLocation();
          router.push(`/spot/${loc.id}?fromMap=1`);
        },
        {
          primary: colors.primary,
          surface: colors.surface,
          surfaceElevated: colors.surfaceElevated,
          colorScheme: resolvedScheme,
        },
        favoriteLocationIds,
      ),
    [
      visibleCatalogLocations,
      router,
      addMode,
      endAddLocation,
      colors.primary,
      colors.surface,
      colors.surfaceElevated,
      resolvedScheme,
      favoriteLocationIds,
    ],
  );

  const visibleBusinesses = useMemo(() => {
    if (!showBusinessesOnMap || mapZoom < MIN_CATALOG_PIN_ZOOM) return [];
    if (!mapViewport) return businesses;
    return businesses.filter(
      (b) =>
        b.latitude != null &&
        b.longitude != null &&
        isPointInBoundingBox(b.latitude, b.longitude, mapViewport),
    );
  }, [businesses, showBusinessesOnMap, mapViewport, mapZoom]);

  const businessMarkers = useMemo(
    () =>
      buildBusinessMapboxMarkers(
        visibleBusinesses,
        (b) => {
          if (anyAdding) endAddLocation();
          router.push(`/business/${b.id}`);
        },
        resolvedScheme,
      ),
    [visibleBusinesses, anyAdding, endAddLocation, router, resolvedScheme],
  );

  // The pin being placed while adding — a real, prominent MarkerView (not the old
  // near-invisible center crosshair). Tapping the map moves it (handleAddModeMapPress).
  const addPinMarker = useMemo<MapboxMapMarker | null>(() => {
    if (!anyAdding || !pinPlaced) return null;
    return {
      id: 'add-pin',
      coordinate: [addPin.longitude, addPin.latitude],
      useMarkerView: true,
      children: (
        <View style={styles.addPinMarker} pointerEvents="none">
          <Ionicons name="location-sharp" size={46} color={colors.primary} />
        </View>
      ),
    };
  }, [anyAdding, pinPlaced, addPin.longitude, addPin.latitude, styles, colors.primary]);

  const allMarkers = useMemo(
    () => [
      ...(showSpotsOnMap ? catalogMarkers : []),
      ...businessMarkers,
      ...(addPinMarker ? [addPinMarker] : []),
    ],
    [showSpotsOnMap, catalogMarkers, businessMarkers, addPinMarker],
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
                anyAdding ? { marginBottom: addSheetHeight } : null,
              ]}
            >
              <TripMapboxMapView
                ref={mapRef}
                containerStyle={styles.map}
                centerCoordinate={mapCenter}
                zoomLevel={mapZoom}
                cameraKey={`map-tab-${cameraNonce}`}
                markers={allMarkers}
                showUserLocation={locationAllowed}
                onMapIdle={handleMapIdle}
                onZoomLevelChange={setMapZoom}
                landOverlayVisible={landOwnershipVisible}
                onMapPress={
                  anyAdding
                    ? handleAddModeMapPress
                    : landOwnershipVisible
                      ? handleLandMapPress
                      : undefined
                }
                onMapLongPress={handleMapLongPress}
                reservePlanTripFabSpacing
                mapTabControlLayout
                expandable={false}
                showLocateButton={!anyAdding}
                showBasemapSwitcher={!anyAdding}
              />
            </View>
            <AddPlaceSheet
              visible={anyAdding && pinPlaced}
              pinLatitude={addPin.latitude}
              pinLongitude={addPin.longitude}
              catalogLocations={activeLocationsOnly(mapDisplayLocations)}
              geocodeProximity={geocodeProximity ?? mapCenter}
              onApplyGeocodeFeature={jumpMapToGeocodeFeature}
              onSelectCatalogLocation={jumpMapToCatalogLocationWhileAdding}
              onRequestClose={endAddLocation}
              onSheetHeightChange={setAddSheetHeight}
              onMapInteractionBlockedChange={setMapInteractionBlocked}
              onSavedLocation={(id) => {
                router.push(`/spot/${id}?fromMap=1`);
                endAddLocation();
              }}
              onSavedBusiness={(id) => {
                router.push(`/business/${id}`);
                endAddLocation();
              }}
            />
          </>
        )}
      </View>

      {!anyAdding ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.headerOverlay,
            {
              paddingTop: effectiveTop + Spacing.sm,
              paddingLeft: Spacing.lg + insets.left,
              paddingRight: Spacing.lg + insets.right,
            },
            styles.headerOverlayIdle,
          ]}
        >
          <View style={styles.searchBlock}>
            <TextInput
              style={[
                styles.searchInput,
                searchAtRest
                  ? styles.searchInputIdle
                  : searchInputFocused
                    ? styles.searchInputEditingGlass
                    : styles.searchInputFilledGlass,
                !searchAtRest && styles.searchInputCompact,
              ]}
              placeholder="Search Locations"
              placeholderTextColor={
                resolvedScheme === 'dark' ? '#CBD5E1' : colors.textSecondary
              }
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
                        renderSuggestionRow(`loc-${loc.id}`, loc.name, () => {
                          router.push(`/spot/${loc.id}?fromMap=1`);
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

          {!showSearchSuggestions ? (
            <View style={styles.layerChipsRow} pointerEvents="box-none">
              <Pressable
                style={[styles.layerChip, showSpotsOnMap ? styles.layerChipOn : styles.layerChipOff]}
                onPress={() => setShowSpotsOnMap((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showSpotsOnMap ? 'Hide fishing spots' : 'Show fishing spots'}
              >
                <Ionicons
                  name="water"
                  size={13}
                  color={showSpotsOnMap ? colors.textInverse : colors.text}
                />
                <Text style={showSpotsOnMap ? styles.layerChipTextOn : styles.layerChipTextOff}>Spots</Text>
              </Pressable>
              <Pressable
                style={[styles.layerChip, showBusinessesOnMap ? styles.layerChipOn : styles.layerChipOff]}
                onPress={() => setShowBusinessesOnMap(!showBusinessesOnMap)}
                accessibilityRole="button"
                accessibilityLabel={showBusinessesOnMap ? 'Hide shops' : 'Show shops'}
              >
                <Ionicons
                  name="storefront"
                  size={13}
                  color={showBusinessesOnMap ? colors.textInverse : colors.text}
                />
                <Text style={showBusinessesOnMap ? styles.layerChipTextOn : styles.layerChipTextOff}>Shops</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {anyAdding ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.headerOverlay,
            {
              paddingTop: effectiveTop + Spacing.sm,
              paddingLeft: Spacing.lg + insets.left,
              paddingRight: Spacing.lg + insets.right,
            },
            styles.headerOverlayIdle,
          ]}
        >
          <View style={styles.searchBlock}>
            <TextInput
              style={[styles.searchInput, styles.searchInputEditingGlass, styles.searchInputCompact]}
              placeholder="Search an address or place…"
              placeholderTextColor={resolvedScheme === 'dark' ? '#CBD5E1' : colors.textSecondary}
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
                        renderSuggestionRow(`add-loc-${loc.id}`, loc.name, () => {
                          setSearchText(loc.name);
                          setSearchInputFocused(false);
                          jumpMapToCatalogLocationWhileAdding(loc);
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
                        renderSuggestionRow(`add-${f.id}`, f.place_name, () =>
                          pickMapSuggestionWhileAdding(f),
                        ),
                      )}
                    </>
                  ) : null}
                </ScrollView>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {landOwnershipVisible ? (
        <LandOwnershipSheet
          info={landSheetOpen ? landInfo : null}
          loading={landSheetOpen && landLoading}
          onClose={closeLandSheet}
        />
      ) : null}
    </View>
  );
}
