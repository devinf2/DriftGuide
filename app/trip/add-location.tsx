import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Modal,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ExpoLocation from 'expo-location';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, USER_LOCATION_ZOOM } from '@/src/constants/mapDefaults';
import { MAPBOX_ACCESS_TOKEN } from '@/src/constants/mapbox';
import { useLocationStore } from '@/src/stores/locationStore';
import { useAuthStore } from '@/src/stores/authStore';
import { Location, LocationType, NearbyLocationResult } from '@/src/types';
import { addCommunityLocation, searchNearbyRootParentCandidates } from '@/src/services/locationService';
import { forwardGeocode, type MapboxGeocodeFeature } from '@/src/services/mapboxGeocoding';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';
import type { MapCameraStatePayload } from '@/src/utils/mapViewport';
import { TripMapboxMapView } from '@/src/components/map/TripMapboxMapView';
import { buildCatalogMapboxMarkers } from '@/src/components/map/catalogMapboxMarkers';

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

function typeLabel(t: LocationType | null): string {
  if (t == null) return 'Select type';
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

function formatProximityKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}

export default function AddLocationScreen() {
  const { colors, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createAddLocationStyles(colors), [colors]);

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ presetName?: string; lat?: string; lng?: string }>();
  const presetLat = parseCoordParam(params.lat);
  const presetLng = parseCoordParam(params.lng);
  const hasPresetMapCoords = Number.isFinite(presetLat) && Number.isFinite(presetLng);
  const { user } = useAuthStore();
  const { fetchLocations, setLastAddedLocationId, locations } = useLocationStore();

  const mapSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const userProximityRef = useRef<[number, number] | null>(null);
  /** When true, search bar changes no longer overwrite the Name field. */
  const nameUserEditedRef = useRef(false);

  const [pin, setPin] = useState<{ latitude: number; longitude: number }>({
    latitude: DEFAULT_MAP_CENTER[1],
    longitude: DEFAULT_MAP_CENTER[0],
  });
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_MAP_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_MAP_ZOOM);
  const [cameraNonce, setCameraNonce] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [name, setName] = useState('');
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [mapSuggestions, setMapSuggestions] = useState<MapboxGeocodeFeature[]>([]);
  const [mapSuggestionsLoading, setMapSuggestionsLoading] = useState(false);
  const [locationType, setLocationType] = useState<LocationType | null>(null);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  /** Full-screen picker: opens immediately on Add tap, then loads candidates (works above MapView on iOS/Android). */
  const [parentPickerPhase, setParentPickerPhase] = useState<'idle' | 'loading' | 'choose'>('idle');
  const [parentPickerCandidates, setParentPickerCandidates] = useState<NearbyLocationResult[]>([]);
  const [parentLinkSaving, setParentLinkSaving] = useState(false);

  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
    if (!nameUserEditedRef.current) {
      setName(firstPartOfSearch(text));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchLocations();
    }, [fetchLocations]),
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
    nameUserEditedRef.current = false;
    setSearchText(decoded);
    setName(firstPartOfSearch(decoded));
  }, [params.presetName]);

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

  /** Initial map: preset from plan-trip suggestion, else user GPS, else regional default (Mapbox). */
  useEffect(() => {
    if (hasPresetMapCoords) {
      setMapCenter([presetLng, presetLat]);
      setMapZoom(USER_LOCATION_ZOOM);
      setPin({ latitude: presetLat, longitude: presetLng });
      setCameraNonce((n) => n + 1);
      return;
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
        const { latitude, longitude } = loc.coords;
        setMapCenter([longitude, latitude]);
        setMapZoom(USER_LOCATION_ZOOM);
        setPin({ latitude, longitude });
        setCameraNonce((n) => n + 1);
      } catch {
        /* keep DEFAULT_MAP_CENTER */
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
    searchText.trim().length >= 2
      ? filterLocationsByQuery(activeLocationsOnly(locations), searchText)
      : [];

  const showSearchSuggestions =
    searchInputFocused &&
    searchText.trim().length >= 2 &&
    (mapSuggestionsLoading || mapSuggestions.length > 0 || savedLocationMatches.length > 0);

  const handleMapIdle = useCallback((state: MapCameraStatePayload) => {
    const [lng, lat] = state.properties.center;
    setPin({ latitude: lat, longitude: lng });
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
    setMapCenter([lng, lat]);
    setMapZoom(USER_LOCATION_ZOOM);
    setCameraNonce((n) => n + 1);
    setSearchInputFocused(false);
  }, []);

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

  const catalogMarkers = useMemo(
    () =>
      buildCatalogMapboxMarkers(
        locations,
        (loc) => {
          handleSelectExisting(loc.id);
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
      handleSelectExisting,
      colors.primary,
      colors.surface,
      colors.surfaceElevated,
      resolvedScheme,
    ],
  );

  const commitNewLocation = useCallback(
    async (parentLocationId: string | null) => {
      if (!user || locationType == null) return;
      setParentLinkSaving(true);
      try {
        const newLoc = await addCommunityLocation(
          name.trim(),
          locationType,
          pin.latitude,
          pin.longitude,
          user.id,
          isPublic,
          parentLocationId,
        );
        if (newLoc) {
          await fetchLocations();
          setLastAddedLocationId(newLoc.id);
          setParentPickerPhase('idle');
          setParentPickerCandidates([]);
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
        setParentPickerPhase('idle');
        setParentPickerCandidates([]);
        setParentLinkSaving(false);
      }
    },
    [
      user,
      locationType,
      name,
      pin.latitude,
      pin.longitude,
      isPublic,
      fetchLocations,
      setLastAddedLocationId,
      router,
    ],
  );

  const handleAddLocationPress = useCallback(() => {
    if (!name.trim()) {
      Alert.alert('Name needed', 'Enter a name for this location.');
      return;
    }
    if (!user) {
      Alert.alert('Sign in required', 'Sign in to add a location.');
      return;
    }
    if (locationType == null) {
      Alert.alert('Location type', 'Choose a type for this location before adding it.');
      return;
    }
    if (!Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude)) {
      Alert.alert(
        'Pin location needed',
        'Pan the map so the pin sits on your spot — we save those map coordinates with your location.',
      );
      return;
    }

    Keyboard.dismiss();
    setParentPickerPhase('loading');
    setParentPickerCandidates([]);

    queueMicrotask(() => {
      void (async () => {
        try {
          const candidates = await searchNearbyRootParentCandidates(pin.latitude, pin.longitude);
          setParentPickerCandidates(candidates);
          setParentPickerPhase('choose');
        } catch {
          setParentPickerPhase('idle');
          setParentPickerCandidates([]);
          Alert.alert('Could not continue', 'Something went wrong loading suggestions. Try again.');
        }
      })();
    });
  }, [name, locationType, pin.latitude, pin.longitude, user]);

  const closeParentPickerWithoutSaving = useCallback(() => {
    if (!parentLinkSaving) {
      setParentPickerPhase('idle');
      setParentPickerCandidates([]);
    }
  }, [parentLinkSaving]);

  const coordsOk = Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude);
  const canSave = name.trim().length > 0 && coordsOk && locationType != null;
  const parentPickerOpen = parentPickerPhase !== 'idle' || parentLinkSaving;
  const addLocationBlocked = !canSave || parentPickerOpen;

  return (
    <>
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
            placeholderTextColor={colors.textTertiary}
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

        <View
          style={styles.mapContainer}
          pointerEvents={parentPickerOpen ? 'none' : 'auto'}
        >
          <TripMapboxMapView
            containerStyle={styles.map}
            centerCoordinate={mapCenter}
            zoomLevel={mapZoom}
            cameraKey={`add-loc-${cameraNonce}`}
            markers={catalogMarkers}
            showUserLocation
            onMapIdle={handleMapIdle}
            onZoomLevelChange={setMapZoom}
          />
          <View style={styles.centerPinWrap} pointerEvents="none">
            <Ionicons name="location-sharp" size={44} color={colors.primary} style={styles.centerPinIcon} />
          </View>
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
                  placeholderTextColor={colors.textTertiary}
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
                  <Text
                    style={[
                      styles.dropdownTextCompact,
                      locationType == null && styles.dropdownPlaceholderCompact,
                    ]}
                    numberOfLines={1}
                  >
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
                  trackColor={{ false: colors.border, true: colors.primary + '99' }}
                  thumbColor={
                    Platform.OS === 'android' ? (isPublic ? colors.primary : colors.textTertiary) : undefined
                  }
                  ios_backgroundColor={colors.border}
                  accessibilityLabel={isPublic ? 'Public location on' : 'Public location off'}
                />
              </View>
            </View>

            <Pressable
              style={[styles.saveButton, addLocationBlocked && styles.saveButtonDisabled]}
              onPress={handleAddLocationPress}
              disabled={addLocationBlocked}
            >
              {parentPickerPhase === 'loading' ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.saveButtonText}>Add location</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </KeyboardAvoidingView>

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
                  locationType != null && locationType === opt.value && styles.modalOptionTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>

    <Modal
      visible={parentPickerOpen}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      presentationStyle="fullScreen"
      onRequestClose={closeParentPickerWithoutSaving}
    >
      <View style={[styles.parentPickerFullScreen, { paddingTop: insets.top + Spacing.md, paddingBottom: insets.bottom + Spacing.md }]}>
        <Text style={styles.parentPickerTitle}>Part of an existing place?</Text>
        {parentPickerPhase === 'loading' && !parentLinkSaving ? (
          <View style={styles.parentLinkSavingWrap}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.parentLinkModalSubtitle}>
              Checking your pin against main locations in DriftGuide…
            </Text>
          </View>
        ) : null}
        {parentPickerPhase === 'choose' && !parentLinkSaving ? (
          <ScrollView
            style={styles.parentPickerScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.parentLinkModalSubtitle}>
              Nothing is saved yet. If this spot belongs inside a larger waterbody we already have, choose it.
              Otherwise save it as its own place.
            </Text>
            {parentPickerCandidates.length > 0 ? (
              parentPickerCandidates.map((c) => (
                <Pressable
                  key={c.id}
                  style={styles.parentLinkOption}
                  onPress={() => commitNewLocation(c.id)}
                >
                  <View style={styles.parentLinkOptionText}>
                    <Text style={styles.parentLinkOptionName} numberOfLines={2}>
                      Part of {c.name}
                    </Text>
                    <Text style={styles.parentLinkOptionMeta}>{formatProximityKm(c.distance_km)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                </Pressable>
              ))
            ) : (
              <Text style={styles.parentPickerEmptyNote}>
                No other main locations matched for linking. You can still save this as a new standalone place.
              </Text>
            )}
            <Pressable style={styles.parentLinkDecline} onPress={() => commitNewLocation(null)}>
              <Text style={styles.parentLinkDeclineText}>No — save as its own place</Text>
            </Pressable>
            <Pressable style={styles.parentLinkCancel} onPress={closeParentPickerWithoutSaving}>
              <Text style={styles.parentLinkCancelText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        ) : null}
        {parentLinkSaving ? (
          <View style={styles.parentPickerSavingOverlay}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.parentLinkModalSubtitle}>Saving your location…</Text>
          </View>
        ) : null}
      </View>
    </Modal>
    </>
  );
}

function createAddLocationStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
  },
  inputSection: {
    backgroundColor: colors.surface,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
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
    maxHeight: 220,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  suggestionsScroll: {
    maxHeight: 220,
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
    minHeight: 200,
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
  formPanel: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
    color: colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  fieldLabelCompact: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  nameFieldInput: {
    backgroundColor: colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dropdownCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 34,
  },
  dropdownTextCompact: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
    marginRight: 2,
  },
  dropdownPlaceholderCompact: {
    color: colors.textTertiary,
    fontWeight: '500',
  },
  dropdownChevronCompact: {
    fontSize: 11,
    color: colors.textSecondary,
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
    color: colors.textSecondary,
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
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: colors.text,
    marginBottom: Spacing.sm,
  },
  modalOption: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  modalOptionActive: {
    backgroundColor: colors.primary + '18',
  },
  modalOptionText: {
    fontSize: FontSize.md,
    color: colors.text,
  },
  modalOptionTextActive: {
    fontWeight: '700',
    color: colors.primary,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  saveButtonDisabled: {
    backgroundColor: colors.textTertiary,
  },
  saveButtonText: {
    color: colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  parentLinkModalCard: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    maxHeight: '88%',
  },
  parentLinkModalSubtitle: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  parentLinkOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: Spacing.sm,
  },
  parentLinkOptionText: {
    flex: 1,
    minWidth: 0,
  },
  parentLinkOptionName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  parentLinkOptionMeta: {
    fontSize: FontSize.xs,
    color: colors.textTertiary,
    marginTop: 2,
  },
  parentLinkDecline: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  parentLinkDeclineText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  parentLinkContinue: {
    marginTop: Spacing.md,
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  parentLinkContinueText: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: colors.textInverse,
  },
  parentLinkCancel: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  parentLinkCancelText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  parentLinkSavingWrap: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.md,
  },
  parentPickerFullScreen: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: Spacing.lg,
  },
  parentPickerTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: Spacing.md,
  },
  parentPickerScroll: {
    flex: 1,
  },
  parentPickerEmptyNote: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  parentPickerSavingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  });
}

