import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import MapView, { Marker, Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius, LocationTypeColors } from '@/src/constants/theme';
import { useLocationStore } from '@/src/stores/locationStore';
import { useAuthStore } from '@/src/stores/authStore';
import { Location, LocationType } from '@/src/types';
import {
  fetchLocationCreatorManageState,
  updateLocationPin,
} from '@/src/services/locationService';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';
import { MapZoomControls } from '@/src/components/map/MapZoomControls';
import { zoomMapRegion } from '@/src/components/map/mapZoom';

const UTAH_CENTER: Region = {
  latitude: 40.7608,
  longitude: -111.8910,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

function isWaterwayType(t: LocationType): boolean {
  return t === 'river' || t === 'stream' || t === 'lake' || t === 'reservoir' || t === 'pond';
}

function catalogMarkerIcon(type: LocationType): keyof typeof Ionicons.glyphMap {
  if (isWaterwayType(type)) return 'water';
  if (type === 'parking') return 'car-outline';
  if (type === 'access_point') return 'walk-outline';
  return 'location';
}

export default function EditSpotPinScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuthStore();
  const { locations, fetchLocations, getLocationById, isLoading: locationsLoading } = useLocationStore();
  const mapRef = useRef<MapView>(null);
  const mapRegionRef = useRef<Region>(UTAH_CENTER);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [initialRegion, setInitialRegion] = useState<Region>(UTAH_CENTER);
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
    const region: Region = {
      latitude: lat0,
      longitude: lng0,
      latitudeDelta: 0.12,
      longitudeDelta: 0.12,
    };
    setInitialRegion(region);
    mapRegionRef.current = region;
    setPin({ latitude: lat0, longitude: lng0 });
    const t = setTimeout(() => mapRef.current?.animateToRegion(region, 400), 120);
    return () => clearTimeout(t);
  }, [allowed, location?.id, lat0, lng0, location]);

  useEffect(() => {
    if (allowed !== false) return;
    Alert.alert(
      'Cannot edit pin',
      'You can only move the pin for spots you created that are not used on any trip yet.',
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

  const handleRegionChangeComplete = useCallback((region: Region) => {
    mapRegionRef.current = region;
    setPin({ latitude: region.latitude, longitude: region.longitude });
    setInitialRegion(region);
  }, []);

  const handleMapZoomIn = useCallback(() => {
    const next = zoomMapRegion(mapRegionRef.current, true);
    mapRef.current?.animateToRegion(next, 180);
  }, []);

  const handleMapZoomOut = useCallback(() => {
    const next = zoomMapRegion(mapRegionRef.current, false);
    mapRef.current?.animateToRegion(next, 180);
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
              <ActivityIndicator color="#FFFFFF" size="small" />
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
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingLabel}>Loading map…</Text>
      </View>
    );
  }

  if (allowed === true && location && !locationsLoading && !coordsReady) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!allowed) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          onRegionChangeComplete={handleRegionChangeComplete}
          showsUserLocation
          showsMyLocationButton
          mapType="standard"
        >
          {mapCatalogLocations.map((loc: Location) => {
            const accent = LocationTypeColors[loc.type] ?? Colors.primary;
            return (
              <Marker
                key={loc.id}
                coordinate={{ latitude: loc.latitude!, longitude: loc.longitude! }}
                tracksViewChanges={false}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={[styles.catalogMarkerBubble, { borderColor: accent }]}>
                  <Ionicons name={catalogMarkerIcon(loc.type)} size={20} color={accent} />
                </View>
              </Marker>
            );
          })}
        </MapView>
        <View style={styles.centerPinWrap} pointerEvents="none">
          <Ionicons name="location-sharp" size={44} color={Colors.primary} style={styles.centerPinIcon} />
        </View>
        <MapZoomControls onZoomIn={handleMapZoomIn} onZoomOut={handleMapZoomOut} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.background,
  },
  loadingLabel: {
    marginTop: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  errorText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  headerSave: {
    color: '#FFFFFF',
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
  catalogMarkerBubble: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
    padding: 6,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
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
