import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator, Platform, Modal, KeyboardAvoidingView, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useTripStore } from '@/src/stores/tripStore';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationFavoritesStore } from '@/src/stores/locationFavoritesStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { usePlanTripHomeSuggestionsStore } from '@/src/stores/planTripHomeSuggestionsStore';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { getLocationsForOfflineStart } from '@/src/services/waterwayCache';
import { Location, LocationConditions, ConditionRating, SessionType } from '@/src/types';
import * as ExpoLocation from 'expo-location';
import { fetchAllLocationConditionsForPlannedTime } from '@/src/services/conditions';
import { getWeatherIconName } from '@/src/services/conditions';
import { getTopFishingSpots, getSeason, getTimeOfDay, type SpotSuggestion } from '@/src/services/ai';
import { enrichContextWithLocationCatchData } from '@/src/services/guideCatchContext';
import { haversineDistance } from '@/src/services/locationService';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';
import { fetchFlies } from '@/src/services/flyService';
import GuideChat from '@/src/components/GuideChat';
import type { AIContext } from '@/src/services/ai';
import { MAPBOX_ACCESS_TOKEN } from '@/src/constants/mapbox';
import { forwardGeocode, type MapboxGeocodeFeature } from '@/src/services/mapboxGeocoding';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';
// Re-enable with plan-trip offline prompt below.
// import { isPlaceCoveredByOfflineDownloads } from '@/src/utils/offlineDownloadCoverage';
import { useOfflineDownloadResumeStore } from '@/src/stores/offlineDownloadResumeStore';

/** Max drive distance (km) for suggested spots — ~2 hours at 60 mph ≈ 120 mi ≈ 193 km. */
const SUGGESTED_SPOTS_MAX_DRIVE_KM = 193;

const PLANNED_WEATHER_UNAVAILABLE_NOTE =
  "Weather data isn't available for your selected date (forecast only reaches about 5 days out). River flow below is still current.";

function ratingColor(colors: ThemeColors, rating: ConditionRating) {
  switch (rating) {
    case 'good':
      return colors.success;
    case 'fair':
      return colors.warning;
    case 'poor':
      return colors.error;
  }
}

function ConditionDot({
  rating,
  colors,
  styles,
}: {
  rating: ConditionRating;
  colors: ThemeColors;
  styles: any;
}) {
  return <View style={[styles.conditionDot, { backgroundColor: ratingColor(colors, rating) }]} />;
}

function ConditionIcon({
  label,
  value,
  rating,
  compact,
  muted,
  colors,
  styles,
}: {
  label: string;
  value: string;
  rating: ConditionRating;
  compact?: boolean;
  muted?: boolean;
  colors: ThemeColors;
  styles: any;
}) {
  const valueColor = muted ? colors.textTertiary : ratingColor(colors, rating);
  return (
    <View style={styles.conditionItem}>
      <View style={[styles.conditionValueRow, compact && styles.conditionValueRowCompact]}>
        {!muted ? (
          <ConditionDot rating={rating} colors={colors} styles={styles} />
        ) : (
          <View style={[styles.conditionDot, { backgroundColor: colors.textTertiary }]} />
        )}
        <Text style={[styles.conditionValue, { color: valueColor }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Text style={styles.conditionLabel}>{label}</Text>
    </View>
  );
}

function SkyIcon({
  conditions,
  compact,
  colors,
  styles,
}: {
  conditions: LocationConditions;
  compact?: boolean;
  colors: ThemeColors;
  styles: any;
}) {
  const unavailable = conditions.plannedTimeWeatherUnavailable;
  const iconName = getWeatherIconName(conditions.sky.condition) as keyof typeof Ionicons.glyphMap;
  const color = unavailable ? colors.textTertiary : ratingColor(colors, conditions.sky.rating);
  return (
    <View style={styles.conditionItem}>
      <View style={[styles.conditionValueRow, compact && styles.conditionValueRowCompact]}>
        <Ionicons name={iconName} size={compact ? 18 : 14} color={color} />
        {!compact ? (
          <Text style={[styles.conditionValue, { color }]} numberOfLines={1}>
            {conditions.sky.label}
          </Text>
        ) : null}
      </View>
      <Text style={styles.conditionLabel}>Sky</Text>
    </View>
  );
}

function ConditionsRow({
  conditions,
  colors,
  styles,
}: {
  conditions: LocationConditions;
  colors: ThemeColors;
  styles: any;
}) {
  const u = conditions.plannedTimeWeatherUnavailable;
  return (
    <View style={styles.conditionsRow}>
      <ConditionIcon
        label="Wind"
        value={u ? '\u2014' : `${conditions.wind.speed_mph}mph`}
        rating={conditions.wind.rating}
        muted={u}
        colors={colors}
        styles={styles}
      />
      <ConditionIcon
        label="Temp"
        value={u ? '\u2014' : `${conditions.temperature.temp_f}\u00B0`}
        rating={conditions.temperature.rating}
        muted={u}
        colors={colors}
        styles={styles}
      />
      <ConditionIcon
        label="Water"
        value={conditions.water.flow_cfs !== null ? `${conditions.water.flow_cfs}` : '\u2014'}
        rating={conditions.water.rating}
        colors={colors}
        styles={styles}
      />
    </View>
  );
}

function formatWaterLabel(conditions: LocationConditions): string {
  if (conditions.water.flow_cfs !== null) {
    return `${conditions.water.flow_cfs} cfs`;
  }
  const labels: Record<string, string> = {
    clear: 'Clear', slightly_stained: 'Slight', stained: 'Stained',
    murky: 'Murky', blown_out: 'Blown', unknown: '\u2014',
  };
  return labels[conditions.water.clarity] || '\u2014';
}

/** Current date/time rounded up to the next 15-minute mark (e.g. 9:08 → 9:15). */
function getNextFifteenMinutes(): Date {
  const d = new Date();
  const minutes = d.getMinutes();
  const next = minutes % 15 === 0 ? minutes : (Math.floor(minutes / 15) + 1) * 15;
  if (next >= 60) {
    d.setHours(d.getHours() + 1);
    d.setMinutes(0);
  } else {
    d.setMinutes(next);
  }
  d.setSeconds(0, 0);
  return d;
}

export default function NewTripScreen() {
  const { colors, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createNewTripStyles(colors), [colors]);
  const pickerThemeVariant = resolvedScheme === 'dark' ? 'dark' : 'light';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const params = useLocalSearchParams<{ locationId?: string; fromHome?: string }>();
  const paramTruthy = (v: string | string[] | undefined) => {
    const s = Array.isArray(v) ? v[0] : v;
    return s === '1' || s === 'true';
  };
  const fromHomeSuggestions = paramTruthy(params.fromHome);

  const { user } = useAuthStore();
  const favoriteIds = useLocationFavoritesStore((s) => s.ids);
  const favoriteLocationIds = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const { planTrip } = useTripStore();
  const { isConnected } = useNetworkStatus();
  const {
    locations, fetchLocations, searchLocations, addRecentLocation,
    getRecentLocations, lastAddedLocationId, setLastAddedLocationId, getLocationById,
    setPendingPlanTripLocationId,
  } = useLocationStore();

  const [offlineLocations, setOfflineLocations] = useState<Location[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showLocationSearch, setShowLocationSearch] = useState(false);
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [conditionsMap, setConditionsMap] = useState<Map<string, LocationConditions>>(new Map());
  const [conditionsLoading, setConditionsLoading] = useState(false);
  const [spotSuggestions, setSpotSuggestions] = useState<SpotSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [plannedDate, setPlannedDate] = useState(() => getNextFifteenMinutes());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [sessionType, setSessionType] = useState<SessionType | null>('wade');
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [mapSuggestions, setMapSuggestions] = useState<MapboxGeocodeFeature[]>([]);
  const [mapSuggestionsLoading, setMapSuggestionsLoading] = useState(false);
  const userProximityRef = useRef<[number, number] | null>(null);
  const mapSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const effectiveLocations = isConnected ? locations : offlineLocations;
  const getEffectiveLocationById = (id: string) => effectiveLocations.find((l) => l.id === id);

  const getGuideContext = useCallback(
    async ({ question }: { question: string }): Promise<AIContext> => {
      let userFlies: Awaited<ReturnType<typeof fetchFlies>> = [];
      if (user?.id) {
        try {
          userFlies = await fetchFlies(user.id);
        } catch {
          // non-blocking
        }
      }
      const base: AIContext = {
        location: selectedLocation ?? null,
        fishingType: 'fly',
        weather: null,
        waterFlow: null,
        currentFly: null,
        fishCount: 0,
        recentEvents: [],
        timeOfDay: getTimeOfDay(plannedDate),
        season: getSeason(plannedDate),
        userFlies: userFlies.length > 0 ? userFlies : null,
      };
      return enrichContextWithLocationCatchData(base, {
        question,
        locations: effectiveLocations,
        userId: user?.id ?? null,
        userLat: userProximityRef.current?.[1] ?? null,
        userLng: userProximityRef.current?.[0] ?? null,
        referenceDate: plannedDate,
      });
    },
    [user?.id, selectedLocation, plannedDate, effectiveLocations],
  );

  useEffect(() => {
    if (isConnected && locations.length === 0) fetchLocations();
  }, [isConnected, locations.length, fetchLocations]);

  useEffect(() => {
    if (!isConnected) return;
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
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected || !MAPBOX_ACCESS_TOKEN) {
      setMapSuggestions([]);
      setMapSuggestionsLoading(false);
      return;
    }
    const q = searchQuery.trim();
    if (!showLocationSearch || q.length < 2) {
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
  }, [searchQuery, showLocationSearch, isConnected]);

  useEffect(() => {
    if (!isConnected) {
      getLocationsForOfflineStart(user?.id).then(setOfflineLocations);
    }
  }, [isConnected, user?.id]);

  useEffect(() => {
    if (!lastAddedLocationId) return;
    const loc = isConnected
      ? getLocationById(lastAddedLocationId)
      : effectiveLocations.find((l) => l.id === lastAddedLocationId);
    if (loc) {
      setSelectedLocation(loc);
      setShowLocationSearch(false);
      setSearchQuery('');
    }
    setLastAddedLocationId(null);
  }, [lastAddedLocationId, effectiveLocations, isConnected, getLocationById, setLastAddedLocationId]);

  // Pre-select location when opened with locationId param (e.g. deep link or Select for trip from Home)
  useEffect(() => {
    const raw = params.locationId;
    const locationId = raw == null ? undefined : Array.isArray(raw) ? raw[0] : raw;
    if (!locationId || effectiveLocations.length === 0) return;
    const loc = effectiveLocations.find((l) => l.id === locationId);
    if (loc) {
      setSelectedLocation(loc);
      setShowLocationSearch(false);
      setSearchQuery('');
    }
  }, [params.locationId, effectiveLocations]);

  // When returning from spot overview after tapping Select: apply pending location (read fresh on focus)
  useFocusEffect(
    useCallback(() => {
      const pendingId = useLocationStore.getState().pendingPlanTripLocationId;
      if (!pendingId) return;
      setPendingPlanTripLocationId(null);
      const loc = getLocationById(pendingId) ?? effectiveLocations.find((l) => l.id === pendingId);
      if (loc) {
        setSelectedLocation(loc);
        setShowLocationSearch(false);
        setSearchQuery('');
      }
    }, [setPendingPlanTripLocationId, getLocationById, effectiveLocations]),
  );

  const topLevelLocations = activeLocationsOnly(isConnected ? locations : offlineLocations).filter(
    (l) => !l.parent_location_id,
  );

  // Use this location's conditions, or its parent's when it's a child (we only fetch for top-level)
  const getConditionsForLocation = useCallback((loc: Location) => {
    return conditionsMap.get(loc.id) ?? (loc.parent_location_id ? conditionsMap.get(loc.parent_location_id) : undefined);
  }, [conditionsMap]);

  useEffect(() => {
    if (topLevelLocations.length === 0) return;

    let cancelled = false;
    setConditionsLoading(true);

    const homeItems = fromHomeSuggestions
      ? usePlanTripHomeSuggestionsStore.getState().items
      : [];
    const useCachedHomeSuggestions = fromHomeSuggestions && homeItems.length > 0;
    if (!useCachedHomeSuggestions) {
      setSuggestionsLoading(true);
    }

    (async () => {
      let spotsForSuggestions = topLevelLocations;
      if (!useCachedHomeSuggestions) {
        try {
          const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await ExpoLocation.getCurrentPositionAsync({
              accuracy: ExpoLocation.Accuracy.Balanced,
            });
            const lat = loc.coords.latitude;
            const lng = loc.coords.longitude;
            const nearby = topLevelLocations.filter((l) => {
              const locLat = l.latitude ?? null;
              const locLng = l.longitude ?? null;
              if (locLat == null || locLng == null) return false;
              return haversineDistance(lat, lng, locLat, locLng) <= SUGGESTED_SPOTS_MAX_DRIVE_KM;
            });
            if (nearby.length > 0) spotsForSuggestions = nearby;
          }
        } catch {
          // use all spots if location fails
        }
      }

      if (cancelled) return;
      const result = await fetchAllLocationConditionsForPlannedTime(topLevelLocations, plannedDate);
      if (cancelled) return;
      setConditionsMap(result);
      setConditionsLoading(false);

      if (useCachedHomeSuggestions) {
        if (!cancelled) {
          setSpotSuggestions(homeItems.map((h) => h.suggestion));
          setSuggestionsLoading(false);
        }
        return;
      }

      const suggestions = await getTopFishingSpots(spotsForSuggestions, result, plannedDate, {
        favoriteLocationIds,
      });
      if (!cancelled) {
        setSpotSuggestions(suggestions);
        setSuggestionsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [topLevelLocations.length, plannedDate.getTime(), fromHomeSuggestions, favoriteLocationIds]);

  const filteredLocations = searchQuery.trim()
    ? isConnected
      ? searchLocations(searchQuery)
      : filterLocationsByQuery(effectiveLocations, searchQuery)
    : [];

  const getParentLocationName = useCallback(
    (loc: Location) => {
      if (!loc.parent_location_id) return null;
      return (
        getLocationById(loc.parent_location_id)?.name ??
        effectiveLocations.find((l) => l.id === loc.parent_location_id)?.name ??
        null
      );
    },
    [getLocationById, effectiveLocations],
  );

  const findLocationForSuggestion = useCallback((suggestion: SpotSuggestion): Location | undefined => {
    return effectiveLocations.find(l =>
      l.name.toLowerCase() === suggestion.locationName.toLowerCase() ||
      suggestion.locationName.toLowerCase().includes(l.name.toLowerCase()) ||
      l.name.toLowerCase().includes(suggestion.locationName.toLowerCase().split(' - ')[0]),
    );
  }, [effectiveLocations]);

  const handleDateChange = useCallback((_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (date) {
      setPlannedDate(prev => {
        const updated = new Date(date);
        updated.setHours(prev.getHours(), prev.getMinutes());
        return updated;
      });
    }
  }, []);

  const handleTimeChange = useCallback((_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (date) {
      setPlannedDate(prev => {
        const updated = new Date(prev);
        updated.setHours(date.getHours(), date.getMinutes());
        return updated;
      });
    }
  }, []);

  const completePlanTripSave = useCallback(async () => {
    if (!user || !selectedLocation) return;
    setSaving(true);
    addRecentLocation(selectedLocation.id);
    const tripId = await planTrip(
      user.id,
      selectedLocation.id,
      'fly',
      selectedLocation,
      plannedDate,
      sessionType,
      null,
    );
    setSaving(false);
    if (tripId) {
      router.back();
    } else {
      Alert.alert('Couldn\'t create trip', 'Something went wrong saving your trip. Check your connection and try again.');
    }
  }, [user, selectedLocation, planTrip, addRecentLocation, router, plannedDate, sessionType]);

  const handlePlanTrip = useCallback(async () => {
    if (!user || !selectedLocation) return;
    if (!sessionType) {
      Alert.alert('Select how you\'ll fish', 'Please choose Wade, Float, or Shore so we can save your trip.');
      return;
    }
    // Optional: prompt to download offline map before saving planned trip (see offline-region-picker + planTripResume).
    // const lat = selectedLocation.latitude;
    // const lng = selectedLocation.longitude;
    // const coordsOk = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
    // if (isConnected && coordsOk && !(await isPlaceCoveredByOfflineDownloads(lat, lng, selectedLocation.id))) {
    //   Alert.alert(
    //     'Download map for offline?',
    //     'This place is not inside a saved offline map region. Download the map now so you can use it without a signal?',
    //     [
    //       {
    //         text: 'Not now',
    //         style: 'cancel',
    //         onPress: () => {
    //           void completePlanTripSave();
    //         },
    //       },
    //       {
    //         text: 'Download',
    //         onPress: () => {
    //           const payload = {
    //             userId: user.id,
    //             locationId: selectedLocation.id,
    //             fishingType: 'fly' as const,
    //             location: selectedLocation,
    //             plannedDateIso: plannedDate.toISOString(),
    //             sessionType,
    //             accessPointId: null as string | null,
    //           };
    //           router.push({
    //             pathname: '/trip/offline-region-picker',
    //             params: {
    //               centerLat: String(lat),
    //               centerLng: String(lng),
    //               locationId: selectedLocation.id,
    //               resumeFlow: 'plan-trip',
    //               planTripPayload: JSON.stringify(payload),
    //             },
    //           });
    //         },
    //       },
    //     ],
    //   );
    //   return;
    // }

    await completePlanTripSave();
  }, [user, selectedLocation, sessionType, completePlanTripSave]);

  useFocusEffect(
    useCallback(() => {
      const p = useOfflineDownloadResumeStore.getState().planTripResume;
      if (!p) return;
      useOfflineDownloadResumeStore.getState().clearPlanTripResume();

      (async () => {
        if (!user) return;
        setSaving(true);
        addRecentLocation(p.locationId);
        const tripId = await planTrip(
          p.userId,
          p.locationId,
          p.fishingType,
          p.location,
          new Date(p.plannedDateIso),
          p.sessionType,
          p.accessPointId,
        );
        setSaving(false);
        if (tripId) {
          router.back();
        } else {
          Alert.alert(
            'Couldn\'t create trip',
            'Something went wrong saving your trip. Check your connection and try again.',
          );
        }
      })();
    }, [user, planTrip, addRecentLocation, router]),
  );

  const handleSelectSuggestion = useCallback((suggestion: SpotSuggestion) => {
    const match = findLocationForSuggestion(suggestion);
    if (match) {
      router.push(`/spot/${match.id}?fromPlanTrip=1`);
    }
  }, [findLocationForSuggestion, router]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <StatusBar style={resolvedScheme === 'dark' ? 'light' : 'dark'} />
      <View style={[styles.planTripHeaderBar, { paddingTop: effectiveTop }]}>
        <View style={[styles.planTripHeaderSide, styles.planTripHeaderSideStart]}>
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
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" style={styles.planTripHeaderBackIcon} />
            <Text style={styles.planTripHeaderBackText}>Back</Text>
          </Pressable>
        </View>
        <Text style={styles.planTripHeaderTitle} numberOfLines={1}>
          Plan a Trip
        </Text>
        <View style={styles.planTripHeaderSide} />
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
      {/* Session type — hidden for now; default remains 'wade' for planTrip.
      <Text style={styles.sectionLabel}>How will you fish?</Text>
      <View style={styles.sessionTypeRow}>
        {(['wade', 'float', 'shore'] as const).map((type) => (
          <Pressable
            key={type}
            style={[styles.sessionPill, sessionType === type && styles.sessionPillSelected]}
            onPress={() => setSessionType(type)}
          >
            <Text style={[styles.sessionPillText, sessionType === type && styles.sessionPillTextSelected]}>
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>
      */}

      {/* Date & Time Selection */}
      <View style={styles.dateTimeRow}>
            <View style={styles.dateTimeColumn}>
              <Text style={styles.dateTimeLabel}>Date</Text>
              <Pressable
                style={styles.dateTimeButton}
                onPress={() => setShowDatePicker(v => !v)}
              >
                <Text style={styles.dateTimeValue} numberOfLines={1}>
                  {format(plannedDate, 'EEE, MMM d')}
                </Text>
              </Pressable>
            </View>
            <View style={styles.dateTimeColumn}>
              <Text style={styles.dateTimeLabel}>Time</Text>
              <Pressable
                style={styles.dateTimeButton}
                onPress={() => setShowTimePicker(v => !v)}
              >
                <Text style={styles.dateTimeValue}>{format(plannedDate, 'h:mm a')}</Text>
              </Pressable>
            </View>
          </View>

          <Modal visible={showDatePicker} transparent animationType="fade">
            <Pressable style={styles.modalOverlay} onPress={() => setShowDatePicker(false)}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Select Date</Text>
                  <Pressable onPress={() => setShowDatePicker(false)}>
                    <Text style={styles.modalDone}>Done</Text>
                  </Pressable>
                </View>
                <DateTimePicker
                  value={plannedDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={handleDateChange}
                  minimumDate={new Date()}
                  themeVariant={pickerThemeVariant}
                />
              </View>
            </Pressable>
          </Modal>

          <Modal visible={showTimePicker} transparent animationType="fade">
            <Pressable style={styles.modalOverlay} onPress={() => setShowTimePicker(false)}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Select Time</Text>
                  <Pressable onPress={() => setShowTimePicker(false)}>
                    <Text style={styles.modalDone}>Done</Text>
                  </Pressable>
                </View>
                <DateTimePicker
                  value={plannedDate}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleTimeChange}
                  minuteInterval={15}
                  themeVariant={pickerThemeVariant}
                />
              </View>
            </Pressable>
          </Modal>

          {(() => {
            for (const c of conditionsMap.values()) {
              if (c.plannedTimeWeatherUnavailable) {
                return (
                  <View style={styles.plannedWeatherNote}>
                    <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                    <Text style={styles.plannedWeatherNoteText}>{PLANNED_WEATHER_UNAVAILABLE_NOTE}</Text>
                  </View>
                );
              }
            }
            return null;
          })()}

      <View style={styles.sectionLabelRow}>
        <Text style={styles.sectionLabel}>Where are you fishing?</Text>
        {isConnected ? (
          <Pressable
            style={({ pressed }) => [styles.useMapButton, pressed && styles.useMapButtonPressed]}
            onPress={() => router.push('/trip/pick-location-map')}
            hitSlop={8}
          >
            <Ionicons name="map-outline" size={16} color={colors.primary} />
            <Text style={styles.useMapButtonText}>Use map</Text>
          </Pressable>
        ) : null}
      </View>

      {selectedLocation ? (
        <Pressable
          style={styles.selectedLocation}
          onPress={() => {
            setSelectedLocation(null);
            setShowLocationSearch(true);
          }}
        >
          <View style={styles.selectedLocationContent}>
            <View style={styles.selectedLocationHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.selectedLocationName}>{selectedLocation.name}</Text>
                {getParentLocationName(selectedLocation) ? (
                  <Text style={styles.sectionSubtitle}>
                    Section of {getParentLocationName(selectedLocation)}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.changeText}>Change</Text>
            </View>
            {(() => {
              const conditions = getConditionsForLocation(selectedLocation);
              const u = conditions?.plannedTimeWeatherUnavailable;
              return conditions ? (
                <View style={styles.selectedConditionsRow}>
                  <View style={styles.selectedConditionItem}>
                    <SkyIcon conditions={conditions} compact colors={colors} styles={styles} />
                  </View>
                  <View style={styles.selectedConditionItem}>
                    <ConditionIcon
                      label="Wind"
                      value={u ? '\u2014' : `${conditions.wind.speed_mph}mph`}
                      rating={conditions.wind.rating}
                      compact
                      muted={u}
                      colors={colors}
                      styles={styles}
                    />
                  </View>
                  <View style={styles.selectedConditionItem}>
                    <ConditionIcon
                      label="Temp"
                      value={u ? '\u2014' : `${conditions.temperature.temp_f}\u00B0F`}
                      rating={conditions.temperature.rating}
                      compact
                      muted={u}
                      colors={colors}
                      styles={styles}
                    />
                  </View>
                  <View style={styles.selectedConditionItem}>
                    <ConditionIcon
                      label="Water"
                      value={formatWaterLabel(conditions)}
                      rating={conditions.water.rating}
                      compact
                      colors={colors}
                      styles={styles}
                    />
                  </View>
                </View>
              ) : null;
            })()}
          </View>
        </Pressable>
      ) : (
        <View>
          <TextInput
            style={styles.searchInput}
            placeholder="Search locations…"
            placeholderTextColor={colors.textTertiary}
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              setShowLocationSearch(true);
            }}
            onFocus={() => {
              setShowLocationSearch(true);
              setSearchInputFocused(true);
            }}
            onBlur={() => setSearchInputFocused(false)}
          />
          {showLocationSearch && searchQuery.trim() !== '' && (
            <View style={styles.locationList}>
              {conditionsLoading && (
                <View style={styles.conditionsLoadingRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.conditionsLoadingText}>Loading conditions...</Text>
                </View>
              )}
              <ScrollView
                style={styles.locationListScroll}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={true}
              >
                {filteredLocations.map((loc) => {
                  const conditions = getConditionsForLocation(loc);
                  const parentName = getParentLocationName(loc);
                  return (
                    <Pressable
                      key={loc.id}
                      style={({ pressed }) => [
                        styles.locationListItem,
                        pressed && styles.locationListItemPressed,
                      ]}
                      onPress={() => {
                        if (isConnected) {
                          router.push(`/spot/${loc.id}?fromPlanTrip=1`);
                        } else {
                          setSelectedLocation(loc);
                          setShowLocationSearch(false);
                          setSearchQuery('');
                        }
                      }}
                    >
                      <View style={styles.locationListItemBody}>
                        <View style={styles.locationMain}>
                          <Text style={styles.locationName}>{loc.name}</Text>
                          {parentName ? (
                            <Text style={styles.sectionSubtitle}>Section of {parentName}</Text>
                          ) : null}
                        </View>
                        {conditions ? <ConditionsRow conditions={conditions} colors={colors} styles={styles} /> : null}
                      </View>
                      {isConnected ? (
                        <Ionicons
                          name="chevron-forward"
                          size={22}
                          color={colors.textTertiary}
                          style={styles.locationListItemChevron}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
                {(mapSuggestionsLoading || mapSuggestions.length > 0) && (
                  <View style={styles.mapSuggestionsBlock}>
                    <Text style={styles.mapSuggestionsHeader}>Map suggestions</Text>
                    {mapSuggestionsLoading ? (
                      <View style={styles.mapSuggestionsLoadingRow}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={styles.conditionsLoadingText}>Searching near you…</Text>
                      </View>
                    ) : (
                      mapSuggestions.map((f) => (
                        <Pressable
                          key={f.id}
                          style={styles.mapSuggestionRow}
                          onPress={() => {
                            const [lng, lat] = f.center;
                            router.push({
                              pathname: '/trip/pick-location-map',
                              params: {
                                presetName: encodeURIComponent(f.place_name),
                                lat: String(lat),
                                lng: String(lng),
                              },
                            });
                          }}
                        >
                          <Ionicons name="map-outline" size={20} color={colors.primary} />
                          <Text style={styles.mapSuggestionText} numberOfLines={3}>
                            {f.place_name}
                          </Text>
                        </Pressable>
                      ))
                    )}
                  </View>
                )}
                {filteredLocations.length === 0 &&
                  !conditionsLoading &&
                  !mapSuggestionsLoading &&
                  mapSuggestions.length === 0 && (
                  <View style={styles.noResultsContainer}>
                    <Text style={styles.noResults}>No locations found</Text>
                    <Pressable
                      style={styles.addLocationButton}
                      onPress={() =>
                        router.push({
                          pathname: '/trip/pick-location-map',
                          params:
                            searchQuery.trim().length > 0
                              ? { presetName: encodeURIComponent(searchQuery.trim()) }
                              : {},
                        })
                      }
                    >
                      <Text style={styles.addLocationButtonText}>Choose on map</Text>
                    </Pressable>
                  </View>
                )}
              </ScrollView>
            </View>
          )}
        </View>
      )}

      {/* Suggested Spots */}
      <View style={styles.suggestedSpotsHeaderRow}>
        <Text style={styles.sectionHeader}>Suggested Spots</Text>
        <Pressable
          style={styles.askGuideButton}
          onPress={() => setShowGuideModal(true)}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.primary} />
          <Text style={styles.askGuideButtonText}>Ask DriftGuide</Text>
        </Pressable>
      </View>
      {suggestionsLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingLabel}>
            {conditionsLoading ? 'Checking weather & conditions...' : 'Getting suggestions...'}
          </Text>
        </View>
      ) : (
        <View style={styles.suggestionsContainer}>
          {spotSuggestions.map((suggestion, index) => {
            const matchedLoc = findLocationForSuggestion(suggestion);
            const conditions = matchedLoc ? getConditionsForLocation(matchedLoc) : undefined;
            return (
              <Pressable
                key={index}
                style={styles.suggestionCard}
                onPress={() => handleSelectSuggestion(suggestion)}
              >
                <View style={styles.suggestionContent}>
                  <View style={styles.suggestionHeader}>
                    <Text style={styles.suggestionName} numberOfLines={1}>{suggestion.locationName}</Text>
                    {conditions && (
                      <View style={styles.suggestionSkyBadge}>
                        <Ionicons
                          name={getWeatherIconName(conditions.sky.condition) as keyof typeof Ionicons.glyphMap}
                          size={13}
                          color={ratingColor(colors, conditions.sky.rating)}
                        />
                        <Text style={[styles.suggestionSkyText, { color: ratingColor(colors, conditions.sky.rating) }]}>
                          {conditions.sky.label}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.suggestionReason}>{suggestion.reason}</Text>
                  {conditions && <ConditionsRow conditions={conditions} colors={colors} styles={styles} />}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <Modal
        visible={showGuideModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowGuideModal(false)}
      >
        <GuideChat
          getContext={getGuideContext}
          variant="modal"
          onClose={() => setShowGuideModal(false)}
          welcomeTitle="Ask DriftGuide"
          welcomeSubtitle="Planning a trip? Ask where to go, what to use, or anything else — I'll use your planned time and location when relevant."
        />
      </Modal>

      </ScrollView>
      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>Offline – showing downloaded waterways only</Text>
        </View>
      )}
      <View style={styles.pinnedButtonContainer}>
        <Pressable
          style={[styles.planButton, (!selectedLocation || !sessionType) && styles.planButtonDisabled]}
          onPress={handlePlanTrip}
          disabled={!selectedLocation || !sessionType || saving}
        >
          {saving ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.planButtonText}>Create Trip</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function createNewTripStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl + 80,
  },
  plannedWeatherNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderRadius: BorderRadius.md,
  },
  plannedWeatherNoteText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  offlineBanner: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: colors.warning + '20',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  offlineBannerText: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  pinnedButtonContainer: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: Spacing.sm,
  },
  suggestedSpotsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.md,
  },
  sectionHeader: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    flex: 1,
  },
  askGuideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    backgroundColor: colors.primaryLight + '40',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary + '60',
  },
  askGuideButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  planTripHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2C4670',
    paddingBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  planTripHeaderSide: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  planTripHeaderSideStart: {
    alignItems: 'flex-start',
  },
  planTripHeaderTitle: {
    flexShrink: 1,
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  planTripHeaderBackIcon: {
    marginLeft: -4,
  },
  planTripHeaderBackText: {
    fontSize: FontSize.md,
    color: '#FFFFFF',
    fontWeight: '400',
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sectionLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    flexShrink: 1,
  },
  useMapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  useMapButtonPressed: {
    opacity: 0.65,
  },
  useMapButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  sectionSubtitle: {
    fontSize: FontSize.xs,
    color: colors.textTertiary,
    marginTop: 2,
  },
  mapSuggestionsBlock: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: Spacing.sm,
    marginTop: Spacing.xs,
  },
  mapSuggestionsHeader: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  mapSuggestionsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  mapSuggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  mapSuggestionText: {
    flex: 1,
    fontSize: FontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  locationListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    paddingLeft: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingRight: Spacing.sm,
  },
  locationListItemPressed: {
    backgroundColor: colors.borderLight + '40',
  },
  locationListItemBody: {
    flex: 1,
    paddingVertical: Spacing.xs,
    paddingRight: Spacing.sm,
  },
  locationListItemChevron: {
    marginRight: Spacing.xs,
  },
  sessionTypeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  sessionPill: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  sessionPillSelected: {
    backgroundColor: colors.primary + '20',
    borderColor: colors.primary,
  },
  sessionPillText: {
    fontSize: FontSize.sm,
    color: colors.text,
  },
  sessionPillTextSelected: {
    fontWeight: '600',
    color: colors.primary,
  },

  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  loadingLabel: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
  },

  suggestionsContainer: {
    marginBottom: Spacing.md,
  },
  suggestionCard: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
  },
  suggestionContent: {
    flex: 1,
  },
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  suggestionName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  suggestionSkyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  suggestionSkyText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  suggestionReason: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },

  searchInput: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  locationList: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 280,
  },
  locationListScroll: {
    maxHeight: 280,
  },
  conditionsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.sm,
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  conditionsLoadingText: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
  },
  locationItem: {
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  locationMain: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
  },
  locationName: {
    fontSize: FontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  locationType: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
    textTransform: 'capitalize',
  },
  conditionsRow: {
    flexDirection: 'row',
    marginTop: Spacing.sm,
    gap: Spacing.md,
    flexWrap: 'wrap',
  },
  conditionItem: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
  },
  conditionValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  conditionValueRowCompact: {
    minHeight: 18,
  },
  conditionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  conditionValue: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  conditionLabel: {
    fontSize: FontSize.xs,
    color: colors.textTertiary,
  },
  noResultsContainer: {
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
  },
  noResults: {
    textAlign: 'center',
    color: colors.textTertiary,
    fontSize: FontSize.md,
  },
  addLocationButton: {
    backgroundColor: colors.primaryLight,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  addLocationButtonText: {
    color: colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  selectedLocation: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  selectedLocationContent: {
    flex: 1,
  },
  selectedLocationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 0,
  },
  selectedLocationName: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  selectedConditionsRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    marginTop: Spacing.xs,
    gap: Spacing.sm,
    width: '100%',
  },
  selectedConditionItem: {
    flex: 1,
    minWidth: 0,
  },
  changeText: {
    fontSize: FontSize.sm,
    color: colors.primary,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingBottom: Spacing.xxl,
    paddingHorizontal: Spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  modalDone: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  dateTimeColumn: {
    flex: 1,
  },
  dateTimeButton: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateTimeLabel: {
    fontSize: FontSize.xs,
    color: colors.textTertiary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  dateTimeValue: {
    fontSize: FontSize.md,
    color: colors.text,
    fontWeight: '600',
  },
  planButton: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  planButtonDisabled: {
    backgroundColor: colors.textTertiary,
    shadowOpacity: 0,
    elevation: 0,
  },
  planButtonText: {
    color: colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  planButtonSecondary: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planButtonSecondaryText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  });
}
