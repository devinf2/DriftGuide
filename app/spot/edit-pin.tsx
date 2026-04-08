import { buildCatalogMapboxMarkers } from '@/src/components/map/catalogMapboxMarkers';
import { TripMapboxMapView } from '@/src/components/map/TripMapboxMapView';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import {
  fetchLocationCreatorManageState,
  updateLocationPin,
} from '@/src/services/locationService';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationFavoritesStore } from '@/src/stores/locationFavoritesStore';
import { useLocationStore } from '@/src/stores/locationStore';
import type { Location } from '@/src/types';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';
import type { MapCameraStatePayload } from '@/src/utils/mapViewport';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export default function EditSpotPinScreen() {
  const { colors, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createEditPinStyles(colors), [colors]);

  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuthStore();
  const { locations, fetchLocations, getLocationById, isLoading: locationsLoading } = useLocationStore();
  const favoriteIds = useLocationFavoritesStore((s) => s.ids);
  const favoriteLocationIds = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_MAP_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_MAP_ZOOM);
  const [cameraNonce, setCameraNonce] = useState(0);
  const [saving, setSaving] = useState(false);

  const location = id ? getLocationById(id) : undefined;
  const parent =
    location?.parent_location_id && locations.length
      ? locations.find((l) => l.id === location.parent_location_id)
      : null;
  const lat0 = location?.latitude ?? parent?.latitude ?? null;
  const lng0 = location?.longitude ?? parent?.longitude ?? null;

  useFocusEffect(
    useCallback(() => {
      void fetchLocations();
    }, [fetchLocations]),
  );

  useEffect(() => {
    if (!id || !user?.id) {
      setAllowed(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const state = await fetchLocationCreatorManageState(id);
      if (cancelled) return;
      if (!state?.isCreator || !state.canManageUnusedOnly) {
        setAllowed(false);
        return;
      }
      setAllowed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, user?.id]);

  useEffect(() => {
    if (allowed !== true || !location) return;
    if (lat0 == null || lng0 == null || !Number.isFinite(lat0) || !Number.isFinite(lng0)) return;
    setMapCenter([lng0, lat0]);
    setMapZoom(USER_LOCATION_ZOOM);
    setPin({ latitude: lat0, longitude: lng0 });
    setCameraNonce((n) => n + 1);
  }, [allowed, location?.id, lat0, lng0, location]);

  useEffect(() => {
    if (allowed !== false) return;
    Alert.alert(
      'Cannot edit pin',
      'You can only move the pin for spots you created. If someone else has a trip here, the pin stays locked.',
      [{ text: 'OK', onPress: () => router.back() }],
    );
  }, [allowed, router]);

  const coordsReady =
    lat0 != null && lng0 != null && Number.isFinite(lat0) && Number.isFinite(lng0);

  useEffect(() => {
    if (allowed !== true || !location || locationsLoading) return;
    if (coordsReady) return;
    Alert.alert(
      'No pin to edit',
      'This location does not have its own coordinates. Try editing from the parent waterbody if needed.',
      [{ text: 'OK', onPress: () => router.back() }],
    );
  }, [allowed, location, locationsLoading, coordsReady, router]);

  const mapCatalogLocations = useMemo(
    () =>
      activeLocationsOnly(locations).filter(
        (l) =>
          l.id !== id &&
          l.latitude != null &&
          l.longitude != null &&
          Number.isFinite(l.latitude) &&
          Number.isFinite(l.longitude),
      ),
    [locations, id],
  );

  const catalogMarkers = useMemo(
    () =>
      buildCatalogMapboxMarkers(mapCatalogLocations, () => {}, {
        primary: colors.primary,
        surface: colors.surface,
        surfaceElevated: colors.surfaceElevated,
        colorScheme: resolvedScheme,
      }, favoriteLocationIds),
    [mapCatalogLocations, colors.primary, colors.surface, colors.surfaceElevated, resolvedScheme, favoriteLocationIds],
  );

  const handleMapIdle = useCallback((state: MapCameraStatePayload) => {
    const [lng, lat] = state.properties.center;
    setPin({ latitude: lat, longitude: lng });
  }, []);

  const handleSave = useCallback(async () => {
    if (!id || !pin || saving) return;
    setSaving(true);
    try {
      const ok = await updateLocationPin(id, pin.latitude, pin.longitude);
      if (ok) {
        await fetchLocations();
        router.back();
      } else {
        Alert.alert(
          'Could not save',
          'This spot may already be used on a trip, or your connection failed. Try again.',
        );
      }
    } finally {
      setSaving(false);
    }
  }, [id, pin, saving, fetchLocations, router]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        allowed === true && pin ? (
          <TouchableOpacity
            onPress={() => void handleSave()}
            disabled={saving}
            activeOpacity={0.65}
            accessibilityRole="button"
            accessibilityLabel="Save pin location"
            hitSlop={{ top: 12, right: 8, bottom: 12, left: 12 }}
            style={[styles.headerActionBtn, { marginRight: Spacing.sm }]}
          >
            {saving ? (
              <ActivityIndicator color={colors.textInverse} size="small" />
            ) : (
              <Text style={styles.headerSave}>Save</Text>
            )}
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation, allowed, pin, saving, handleSave]);

  if (!id) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Missing location</Text>
      </View>
    );
  }

  if (!locationsLoading && locations.length > 0 && !location) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Spot not found</Text>
      </View>
    );
  }

  if (
    allowed === null ||
    locationsLoading ||
    (allowed === true && location && coordsReady && pin == null)
  ) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingLabel}>Loading map…</Text>
      </View>
    );
  }

  if (allowed === true && location && !locationsLoading && !coordsReady) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!allowed) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.mapContainer}>
        {Platform.OS === 'web' ? (
          <View style={styles.webPlaceholder}>
            <Ionicons name="map" size={48} color={colors.textTertiary} />
            <Text style={styles.webPlaceholderText}>Edit pin is available in the iOS and Android app with Mapbox.</Text>
          </View>
        ) : (
          <>
            <TripMapboxMapView
              containerStyle={styles.map}
              centerCoordinate={mapCenter}
              zoomLevel={mapZoom}
              cameraKey={`edit-pin-${cameraNonce}`}
              markers={catalogMarkers}
              showUserLocation
              onMapIdle={handleMapIdle}
              onZoomLevelChange={setMapZoom}
            />
            <View style={styles.centerPinWrap} pointerEvents="none">
              <Ionicons name="location-sharp" size={44} color={colors.primary} style={styles.centerPinIcon} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function createEditPinStyles(colors: ThemeColors) {
  return StyleSheet.create({
  headerActionBtn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 44,
    minHeight: 36,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
    backgroundColor: colors.background,
  },
  loadingLabel: {
    marginTop: Spacing.md,
    fontSize: FontSize.sm,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
  },
  headerSave: {
    color: colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  mapContainer: {
    flex: 1,
    minHeight: 200,
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
  centerPinWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerPinIcon: {
    marginBottom: 26,
  },
  });
}

