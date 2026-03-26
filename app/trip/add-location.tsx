import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MapView, { Marker, Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as ExpoLocation from 'expo-location';
import { Colors, Spacing, FontSize, BorderRadius, LocationTypeColors } from '@/src/constants/theme';
import { MAPBOX_ACCESS_TOKEN } from '@/src/constants/mapbox';
import { useLocationStore } from '@/src/stores/locationStore';
import { useAuthStore } from '@/src/stores/authStore';
import { Location, LocationType } from '@/src/types';
import { addCommunityLocation } from '@/src/services/locationService';
import { forwardGeocode, type MapboxGeocodeFeature } from '@/src/services/mapboxGeocoding';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';
import { MapZoomControls } from '@/src/components/map/MapZoomControls';
import { zoomMapRegion } from '@/src/components/map/mapZoom';

const UTAH_CENTER: Region = {
  latitude: 40.7608,
  longitude: -111.8910,
  latitudeDelta: 0.25,
  longitudeDelta: 0.25,
};

/** All values must match Postgres `location_type` enum (see migrations). */
const LOCATION_TYPE_OPTIONS: { value: LocationType; label: string }[] = [
  { value: 'river', label: 'River' },
  { value: 'stream', label: 'Stream' },
  { value: 'lake', label: 'Lake' },
  { value: 'reservoir', label: 'Reservoir' },
  { value: 'pond', label: 'Pond' },
  { value: 'access_point', label: 'Access point' },
  { value: 'parking', label: 'Parking' },
];

function typeLabel(t: LocationType): string {
  return LOCATION_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

/** Short label for saved name: text before first comma (e.g. street segment of an address). */
function firstPartOfSearch(s: string): string {
  const t = s.trim();
  if (!t) return '';
  const comma = t.indexOf(',');
  return (comma === -1 ? t : t.slice(0, comma)).trim();
}

function parseCoordParam(s: string | undefined): number {
  if (s == null || s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function isWaterwayType(t: LocationType): boolean {
  return t === 'river' || t === 'stream' || t === 'lake' || t === 'reservoir' || t === 'pond';
}

function catalogMarkerIcon(type: LocationType): keyof typeof Ionicons.glyphMap {
  if (isWaterwayType(type)) return 'water';
  if (type === 'parking') return 'car-outline';
  if (type === 'access_point') return 'walk-outline';
  return 'location';
}

export default function AddLocationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ presetName?: string; lat?: string; lng?: string }>();
  const presetLat = parseCoordParam(params.lat);
  const presetLng = parseCoordParam(params.lng);
  const hasPresetMapCoords = Number.isFinite(presetLat) && Number.isFinite(presetLng);
  const { user } = useAuthStore();
  const { fetchLocations, setLastAddedLocationId, locations } = useLocationStore();

  const mapRef = useRef<MapView>(null);
  const mapRegionRef = useRef<Region>(UTAH_CENTER);
  const mapSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const userProximityRef = useRef<[number, number] | null>(null);
  /** When true, search bar changes no longer overwrite the Name field. */
  const nameUserEditedRef = useRef(false);

  const [pin, setPin] = useState<{ latitude: number; longitude: number }>({
    latitude: UTAH_CENTER.latitude,
    longitude: UTAH_CENTER.longitude,
  });
  const [initialRegion, setInitialRegion] = useState<Region>(UTAH_CENTER);
  const [searchText, setSearchText] = useState('');
  const [name, setName] = useState('');
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [mapSuggestions, setMapSuggestions] = useState<MapboxGeocodeFeature[]>([]);
  const [mapSuggestionsLoading, setMapSuggestionsLoading] = useState(false);
  const [locationType, setLocationType] = useState<LocationType>('stream');
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
    if (!nameUserEditedRef.current) {
      setName(firstPartOfSearch(text));
    }
  }, []);

  useEffect(() => {
    if (locations.length === 0) fetchLocations();
  }, [locations.length, fetchLocations]);

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
    nameUserEditedRef.current = false;
    setSearchText(decoded);
    setName(firstPartOfSearch(decoded));
  }, [params.presetName]);

  useEffect(() => {
    mapRegionRef.current = initialRegion;
  }, [initialRegion]);

  /** Bias Mapbox search near the user (does not move the map when preset coords are provided). */
  useEffect(() => {
    (async () => {
      try {
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        userProximityRef.current = [loc.coords.longitude, loc.coords.latitude];
      } catch {
        userProximityRef.current = null;
      }
    })();
  }, []);

  /** Initial map center: preset from plan-trip map suggestion, else user GPS, else Utah default. */
  useEffect(() => {
    if (hasPresetMapCoords) {
      const region: Region = {
        latitude: presetLat,
        longitude: presetLng,
        latitudeDelta: 0.12,
        longitudeDelta: 0.12,
      };
      setInitialRegion(region);
      setPin({ latitude: presetLat, longitude: presetLng });
      mapRegionRef.current = region;
      const id = setTimeout(() => {
        mapRef.current?.animateToRegion(region, 600);
      }, 100);
      return () => clearTimeout(id);
    }

    let cancelled = false;
    (async () => {
      try {
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const loc = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        if (cancelled) return;
        const region: Region = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.12,
          longitudeDelta: 0.12,
        };
        setInitialRegion(region);
        setPin({ latitude: region.latitude, longitude: region.longitude });
        mapRegionRef.current = region;
        mapRef.current?.animateToRegion(region, 600);
      } catch {
        /* keep Utah default from initial state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasPresetMapCoords, presetLat, presetLng]);

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

  const savedLocationMatches =
    searchText.trim().length >= 2 ? filterLocationsByQuery(locations, searchText) : [];

  const showSearchSuggestions =
    searchInputFocused &&
    searchText.trim().length >= 2 &&
    (mapSuggestionsLoading || mapSuggestions.length > 0 || savedLocationMatches.length > 0);

  const mapCatalogLocations = useMemo(
    () =>
      locations.filter(
        (l) =>
          l.latitude != null &&
          l.longitude != null &&
          Number.isFinite(l.latitude) &&
          Number.isFinite(l.longitude),
      ),
    [locations],
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

  const handleSelectExisting = useCallback(
    (locationId: string) => {
      setLastAddedLocationId(locationId);
      router.back();
    },
    [router, setLastAddedLocationId],
  );

  const applyMapFeatureToMap = useCallback((f: MapboxGeocodeFeature) => {
    const [lng, lat] = f.center;
    nameUserEditedRef.current = false;
    setSearchText(f.place_name);
    setName(firstPartOfSearch(f.place_name));
    setPin({ latitude: lat, longitude: lng });
    const region: Region = {
      latitude: lat,
      longitude: lng,
      latitudeDelta: 0.12,
      longitudeDelta: 0.12,
    };
    setInitialRegion(region);
    mapRegionRef.current = region;
    mapRef.current?.animateToRegion(region, 500);
    setSearchInputFocused(false);
  }, []);

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

  const handleSave = useCallback(async () => {
    if (!name.trim() || !user) return;
    if (!Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude)) {
      Alert.alert(
        'Pin location needed',
        'Pan the map so the pin sits on your spot — we save those map coordinates with your location.',
      );
      return;
    }

    setSaving(true);
    try {
      const newLoc = await addCommunityLocation(
        name.trim(),
        locationType,
        pin.latitude,
        pin.longitude,
        user.id,
        isPublic,
      );

      if (newLoc) {
        await fetchLocations();
        setLastAddedLocationId(newLoc.id);
        router.replace(`/spot/${newLoc.id}`);
      } else {
        Alert.alert(
          'Could not add location',
          'Check your connection. If you still see this, apply the latest Supabase migrations for this app (your database may be missing columns such as locations.created_by).',
        );
      }
    } catch {
      Alert.alert('Could not add location', 'Something went wrong. Try again when you have a stable connection.');
    } finally {
      setSaving(false);
    }
  }, [
    name,
    locationType,
    pin.latitude,
    pin.longitude,
    user,
    isPublic,
    fetchLocations,
    setLastAddedLocationId,
    router,
  ]);

  const coordsOk = Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude);
  const canSave = name.trim().length > 0 && coordsOk;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <View style={styles.body}>
        <View style={styles.inputSection}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search map & DriftGuide…"
            placeholderTextColor={Colors.textTertiary}
            value={searchText}
            onChangeText={handleSearchChange}
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
                      renderSuggestionRow(`loc-${loc.id}`, loc.name, 'Use existing location', () =>
                        handleSelectExisting(loc.id),
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
            {mapCatalogLocations.map((loc) => {
              const accent = LocationTypeColors[loc.type] ?? Colors.primary;
              return (
                <Marker
                  key={loc.id}
                  coordinate={{ latitude: loc.latitude!, longitude: loc.longitude! }}
                  onPress={() => handleSelectExisting(loc.id)}
                  tracksViewChanges={false}
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View style={[styles.catalogMarkerBubble, { borderColor: accent }]}>
                    <Ionicons
                      name={catalogMarkerIcon(loc.type)}
                      size={20}
                      color={accent}
                    />
                  </View>
                </Marker>
              );
            })}
          </MapView>
          <View style={styles.centerPinWrap} pointerEvents="none">
            <Ionicons name="location-sharp" size={44} color={Colors.primary} style={styles.centerPinIcon} />
          </View>
          <View style={styles.mapHint} pointerEvents="none">
            <View style={styles.mapHintBubble}>
              <Text style={styles.mapHintText}>
                Tap a saved pin to open that location, or pan the map to place a new one
              </Text>
            </View>
          </View>
          <MapZoomControls onZoomIn={handleMapZoomIn} onZoomOut={handleMapZoomOut} />
        </View>

        <View style={styles.formPanel}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.formScrollContent}
          >
            <View style={styles.nameTypeRow}>
              <View style={styles.nameCol}>
                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  style={styles.nameFieldInput}
                  placeholder="Saved name"
                  placeholderTextColor={Colors.textTertiary}
                  value={name}
                  onChangeText={(t) => {
                    nameUserEditedRef.current = true;
                    setName(t);
                  }}
                  returnKeyType="done"
                />
              </View>
              <View style={styles.typeCol}>
                <Text style={styles.fieldLabelCompact}>Type</Text>
                <Pressable style={styles.dropdownCompact} onPress={() => setTypePickerOpen(true)}>
                  <Text style={styles.dropdownTextCompact} numberOfLines={1}>
                    {typeLabel(locationType)}
                  </Text>
                  <Text style={styles.dropdownChevronCompact}>▾</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.publicLocationRow}>
              <Text style={styles.publicLocationLabel}>Public location</Text>
              <View style={styles.publicSwitchWrap}>
                <Switch
                  value={isPublic}
                  onValueChange={setIsPublic}
                  trackColor={{ false: Colors.border, true: Colors.primary + '99' }}
                  thumbColor={
                    Platform.OS === 'android' ? (isPublic ? Colors.primary : Colors.textTertiary) : undefined
                  }
                  ios_backgroundColor={Colors.border}
                  accessibilityLabel={isPublic ? 'Public location on' : 'Public location off'}
                />
              </View>
            </View>

            <Pressable
              style={[styles.saveButton, (!canSave || saving) && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={!canSave || saving}
            >
              {saving ? (
                <ActivityIndicator color={Colors.textInverse} />
              ) : (
                <Text style={styles.saveButtonText}>Add location</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>

      <Modal
        visible={typePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTypePickerOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setTypePickerOpen(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Location type</Text>
            {LOCATION_TYPE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.modalOption, locationType === opt.value && styles.modalOptionActive]}
                onPress={() => {
                  setLocationType(opt.value);
                  setTypePickerOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.modalOptionText,
                    locationType === opt.value && styles.modalOptionTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  body: {
    flex: 1,
  },
  inputSection: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
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
    maxHeight: 220,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
  },
  suggestionsScroll: {
    maxHeight: 220,
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
  mapHint: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: Spacing.md,
  },
  mapHintBubble: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  mapHintText: {
    color: '#FFFFFF',
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  formPanel: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    maxHeight: 380,
  },
  formScrollContent: {
    paddingBottom: Spacing.sm,
  },
  nameTypeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  nameCol: {
    flex: 1,
    minWidth: 0,
  },
  typeCol: {
    width: 118,
    flexShrink: 0,
  },
  fieldLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  fieldLabelCompact: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  nameFieldInput: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dropdownCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 34,
  },
  dropdownTextCompact: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
    marginRight: 2,
  },
  dropdownChevronCompact: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  publicLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    minHeight: 32,
  },
  publicLocationLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textSecondary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  publicSwitchWrap: {
    transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }],
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  modalOption: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  modalOptionActive: {
    backgroundColor: Colors.primary + '18',
  },
  modalOptionText: {
    fontSize: FontSize.md,
    color: Colors.text,
  },
  modalOptionTextActive: {
    fontWeight: '700',
    color: Colors.primary,
  },
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  saveButtonDisabled: {
    backgroundColor: Colors.textTertiary,
  },
  saveButtonText: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
});
