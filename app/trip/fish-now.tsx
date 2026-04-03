import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ExpoLocation from 'expo-location';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { useTripStore } from '@/src/stores/tripStore';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import {
  addCommunityLocation,
  isWithinPinParentReuseThreshold,
  searchNearbyRootParentCandidates,
} from '@/src/services/locationService';
import type { Location, LocationType, NearbyLocationResult } from '@/src/types';
import {
  LocationPinParentTwoStepFlow,
  type PinParentFlowStep,
} from '@/src/components/location/LocationPinParentTwoStepFlow';

/**
 * Provo, UT — used in __DEV__ when the simulator has no GPS or location calls fail,
 * so Fish now and nearby-water search still work locally.
 */
const DEV_FALLBACK_COORDS = { latitude: 40.2338, longitude: -111.6585 } as const;

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

function nearbyResultToLocation(c: NearbyLocationResult): Location {
  const st = c.status;
  const status =
    st === 'verified' || st === 'community' || st === 'pending' ? st : undefined;
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    parent_location_id: null,
    latitude: c.latitude,
    longitude: c.longitude,
    metadata: {},
    status,
  };
}

type Phase = 'locating' | 'loading_parents' | 'pick_parent' | 'busy';

export default function FishNowScreen() {
  const { colors, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pickerTheme = resolvedScheme === 'dark' ? 'dark' : 'light';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { startTrip } = useTripStore();
  const { fetchLocations, locations, addRecentLocation } = useLocationStore();
  const { isConnected } = useNetworkStatus();

  const [phase, setPhase] = useState<Phase>('locating');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [devFallbackNotice, setDevFallbackNotice] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [pinCoords, setPinCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapFocusNonce, setMapFocusNonce] = useState(0);
  const initialGpsSyncedRef = useRef(false);
  const [candidates, setCandidates] = useState<NearbyLocationResult[]>([]);
  const [detailsParentId, setDetailsParentId] = useState<string | null>(null);
  const [pickerFlowStep, setPickerFlowStep] = useState<PinParentFlowStep>(1);

  const [name, setName] = useState('');
  const [locationType, setLocationType] = useState<LocationType | null>(null);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(true);

  const selectedParentGeo = useMemo(() => {
    if (!detailsParentId) return null;
    const fromStore = locations.find((l) => l.id === detailsParentId);
    if (fromStore?.latitude != null && fromStore.longitude != null) {
      return { lat: fromStore.latitude, lng: fromStore.longitude };
    }
    const fromCand = candidates.find((c) => c.id === detailsParentId);
    if (fromCand) return { lat: fromCand.latitude, lng: fromCand.longitude };
    return null;
  }, [detailsParentId, locations, candidates]);

  const closePinToSelectedParent = useMemo(() => {
    if (detailsParentId == null || selectedParentGeo == null) return false;
    const anchor = pinCoords ?? userCoords;
    if (!anchor) return false;
    return isWithinPinParentReuseThreshold(
      anchor.latitude,
      anchor.longitude,
      selectedParentGeo.lat,
      selectedParentGeo.lng,
    );
  }, [detailsParentId, selectedParentGeo, pinCoords, userCoords]);

  const showDetailsSpotFields = useMemo(
    () => detailsParentId == null || !closePinToSelectedParent,
    [detailsParentId, closePinToSelectedParent],
  );

  const resolveLocationForParentId = useCallback(
    (parentId: string): Location | null => {
      const fromStore = locations.find((l) => l.id === parentId);
      if (fromStore) return fromStore;
      const fromCand = candidates.find((c) => c.id === parentId);
      return fromCand ? nearbyResultToLocation(fromCand) : null;
    },
    [locations, candidates],
  );

  useEffect(() => {
    void fetchLocations();
  }, [fetchLocations]);

  useEffect(() => {
    if (!userCoords || initialGpsSyncedRef.current) return;
    initialGpsSyncedRef.current = true;
    setPinCoords(userCoords);
    setMapFocusNonce((n) => n + 1);
  }, [userCoords]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setGpsError(null);
      setDevFallbackNotice(null);
      setPhase('locating');
      try {
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (__DEV__) {
            if (!cancelled) {
              setUserCoords({ ...DEV_FALLBACK_COORDS });
              setDevFallbackNotice('Dev: using Provo, UT — location permission not granted (simulator-friendly).');
              setPhase('loading_parents');
              const rows = await searchNearbyRootParentCandidates(
                DEV_FALLBACK_COORDS.latitude,
                DEV_FALLBACK_COORDS.longitude,
              );
              if (cancelled) return;
              setCandidates(rows);
              setPhase('pick_parent');
            }
            return;
          }
          if (!cancelled) {
            setGpsError('Location permission is needed to find nearby waters and start your trip.');
            setPhase('pick_parent');
          }
          return;
        }
        const loc = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        if (cancelled) return;
        const { latitude, longitude } = loc.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          throw new Error('invalid coords');
        }
        setUserCoords({ latitude, longitude });
        setPhase('loading_parents');
        const rows = await searchNearbyRootParentCandidates(latitude, longitude);
        if (cancelled) return;
        setCandidates(rows);
        setPhase('pick_parent');
      } catch {
        if (__DEV__) {
          if (!cancelled) {
            setUserCoords({ ...DEV_FALLBACK_COORDS });
            setDevFallbackNotice('Dev: using Provo, UT — GPS unavailable (typical in simulator).');
            setGpsError(null);
            setPhase('loading_parents');
            try {
              const rows = await searchNearbyRootParentCandidates(
                DEV_FALLBACK_COORDS.latitude,
                DEV_FALLBACK_COORDS.longitude,
              );
              if (cancelled) return;
              setCandidates(rows);
              setPhase('pick_parent');
            } catch {
              if (!cancelled) {
                setCandidates([]);
                setPhase('pick_parent');
              }
            }
          }
          return;
        }
        if (!cancelled) {
          setGpsError('Could not read your location. Try again or move outdoors for a better signal.');
          setPhase('pick_parent');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startOnExistingLocation = useCallback(
    async (loc: Location) => {
      if (!user) {
        Alert.alert('Sign in required', 'Sign in to start a trip.');
        return;
      }
      const { activeTrip: existing, isTripPaused } = useTripStore.getState();
      if (existing?.status === 'active') {
        Alert.alert(
          'Trip in progress',
          isTripPaused
            ? 'Resume or end your paused trip before starting a new one.'
            : 'End or pause your current trip before starting a new one.',
        );
        return;
      }
      setPhase('busy');
      addRecentLocation(loc.id);
      const tripId = await startTrip(user.id, loc.id, 'fly', loc, 'wade');
      router.replace(`/trip/${tripId}`);
    },
    [user, addRecentLocation, startTrip, router],
  );

  const handlePickParent = useCallback(
    (c: NearbyLocationResult) => {
      const anchor = pinCoords ?? userCoords;
      if (!anchor) return;
      if (isWithinPinParentReuseThreshold(anchor.latitude, anchor.longitude, c.latitude, c.longitude)) {
        const fromStore = locations.find((l) => l.id === c.id);
        void startOnExistingLocation(fromStore ?? nearbyResultToLocation(c));
        return;
      }
      setDetailsParentId(c.id);
      setName('');
      setLocationType(c.type);
      setPickerFlowStep(2);
    },
    [pinCoords, userCoords, locations, startOnExistingLocation],
  );

  const handleStandalone = useCallback(() => {
    setDetailsParentId(null);
    setName('');
    setLocationType(null);
    setPickerFlowStep(2);
  }, []);

  const handleBackFromSpotStep = useCallback(() => {
    if (phase === 'busy') return;
    if (candidates.length === 0) {
      router.back();
      return;
    }
    setPickerFlowStep(1);
    setDetailsParentId(null);
  }, [phase, candidates.length, router]);

  useEffect(() => {
    if (phase !== 'pick_parent') return;
    if (candidates.length > 0) return;
    setPickerFlowStep(2);
    setDetailsParentId(null);
    setName('');
    setLocationType(null);
  }, [phase, candidates.length]);

  const handleStartWithNewSpot = useCallback(async () => {
    const anchor = pinCoords ?? userCoords;
    if (!user || !anchor) {
      Alert.alert('Sign in required', 'Sign in to start a trip.');
      return;
    }

    if (detailsParentId && selectedParentGeo) {
      if (
        isWithinPinParentReuseThreshold(
          anchor.latitude,
          anchor.longitude,
          selectedParentGeo.lat,
          selectedParentGeo.lng,
        )
      ) {
        const loc = resolveLocationForParentId(detailsParentId);
        if (loc) {
          void startOnExistingLocation(loc);
          return;
        }
      }
    }

    if (!isConnected) {
      Alert.alert('Offline', 'Adding a spot requires a connection. Try again when you are online.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Name needed', 'Enter a name for this spot.');
      return;
    }
    if (locationType == null) {
      Alert.alert('Location type', 'Choose a type before starting.');
      return;
    }
    const { activeTrip: existing, isTripPaused } = useTripStore.getState();
    if (existing?.status === 'active') {
      Alert.alert(
        'Trip in progress',
        isTripPaused
          ? 'Resume or end your paused trip before starting a new one.'
          : 'End or pause your current trip before starting a new one.',
      );
      return;
    }
    setPhase('busy');
    const newLoc = await addCommunityLocation(
      name.trim(),
      locationType,
      anchor.latitude,
      anchor.longitude,
      user.id,
      isPublic,
      detailsParentId,
    );
    if (!newLoc) {
      setPhase('pick_parent');
      setPickerFlowStep(2);
      Alert.alert(
        'Could not save spot',
        'Check your connection. If this keeps happening, confirm your Supabase migrations are up to date.',
      );
      return;
    }
    await fetchLocations();
    addRecentLocation(newLoc.id);
    const tripId = await startTrip(user.id, newLoc.id, 'fly', newLoc, 'wade');
    router.replace(`/trip/${tripId}`);
  }, [
    user,
    pinCoords,
    userCoords,
    isConnected,
    name,
    locationType,
    isPublic,
    detailsParentId,
    selectedParentGeo,
    resolveLocationForParentId,
    startOnExistingLocation,
    fetchLocations,
    addRecentLocation,
    startTrip,
    router,
  ]);

  const isTripBusy = phase === 'busy';
  const coord = pinCoords ?? userCoords;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <StatusBar style={pickerTheme === 'dark' ? 'light' : 'dark'} />
      <View style={[styles.headerBar, { paddingTop: insets.top }]}>
        <View style={[styles.headerSide, styles.headerSideStart]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() =>
              phase === 'pick_parent' && pickerFlowStep === 2 && !isTripBusy
                ? handleBackFromSpotStep()
                : router.back()
            }
            style={({ pressed }) => [styles.headerBackPress, { opacity: pressed ? 0.65 : 1 }]}
            hitSlop={12}
            disabled={isTripBusy}
          >
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
            <Text style={styles.headerBackText}>Back</Text>
          </Pressable>
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Fish now
        </Text>
        <View style={styles.headerSide} />
      </View>

      <View style={[styles.pickerBody, { paddingBottom: insets.bottom + Spacing.md }]}>
        {gpsError ? <Text style={styles.errorBanner}>{gpsError}</Text> : null}
        {devFallbackNotice ? <Text style={styles.devFallbackBanner}>{devFallbackNotice}</Text> : null}
        {phase === 'locating' || phase === 'loading_parents' ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.loadingCaption}>
              {phase === 'locating' ? 'Getting your location…' : 'Finding nearby waters…'}
            </Text>
          </View>
        ) : null}
        {phase === 'pick_parent' && !gpsError && userCoords == null ? (
          <View style={styles.centerBlock}>
            <Text style={styles.loadingCaption}>Turn on location to use Fish now.</Text>
          </View>
        ) : null}
        {(phase === 'pick_parent' || phase === 'busy') && userCoords != null && coord != null ? (
          <LocationPinParentTwoStepFlow
            latitude={coord.latitude}
            longitude={coord.longitude}
            onCoordinateChange={(lat, lng) => setPinCoords({ latitude: lat, longitude: lng })}
            mapFocusKey={mapFocusNonce}
            mapFallbackCenter={[userCoords.longitude, userCoords.latitude]}
            mapFlex={1}
            bottomPanelFlex={1}
            step={pickerFlowStep}
            candidates={candidates}
            onPressCandidate={handlePickParent}
            notPartOfListLabel="No — save as its own place"
            onPressNotPartOfList={handleStandalone}
            showSpotDetailFields={showDetailsSpotFields}
            name={name}
            onNameChange={setName}
            locationType={locationType}
            typeLabel={typeLabel}
            onPressOpenTypePicker={() => setTypePickerOpen(true)}
            isPublic={isPublic}
            onIsPublicChange={setIsPublic}
            primaryButtonLabel="Start fishing"
            onPressPrimary={() => void handleStartWithNewSpot()}
            primaryBusy={isTripBusy}
            interactionDisabled={isTripBusy}
            bottomInsetPadding={Spacing.md}
          />
        ) : null}
        {phase === 'busy' && userCoords != null ? (
          <View style={styles.busyOverlay}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.loadingCaption}>Starting your trip…</Text>
          </View>
        ) : null}
      </View>

      <Modal visible={typePickerOpen} transparent animationType="fade" onRequestClose={() => setTypePickerOpen(false)}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setTypePickerOpen(false)}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Location type</Text>
            {LOCATION_TYPE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.modalRow, locationType === opt.value && styles.modalRowActive]}
                onPress={() => {
                  setLocationType(opt.value);
                  setTypePickerOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.modalRowText,
                    locationType === opt.value && styles.modalRowTextActive,
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

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#2C4670',
      paddingBottom: Spacing.sm,
      paddingHorizontal: Spacing.xs,
    },
    headerSide: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
    },
    headerSideStart: {
      alignItems: 'flex-start',
    },
    headerBackPress: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginLeft: 8,
      paddingVertical: Spacing.sm,
      paddingRight: Spacing.sm,
    },
    headerBackText: {
      fontSize: FontSize.md,
      color: '#FFFFFF',
      fontWeight: '400',
    },
    headerTitle: {
      flexShrink: 1,
      fontSize: FontSize.lg,
      fontWeight: '600',
      color: '#FFFFFF',
      textAlign: 'center',
    },
    pickerBody: {
      flex: 1,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
    },
    centerBlock: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.xxl,
    },
    loadingCaption: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: Spacing.lg,
    },
    errorBanner: {
      fontSize: FontSize.sm,
      color: colors.error,
      marginBottom: Spacing.md,
      lineHeight: 20,
    },
    devFallbackBanner: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginBottom: Spacing.md,
      lineHeight: 20,
      padding: Spacing.sm,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.warning + '22',
      overflow: 'hidden',
    },
    busyOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.background + 'E6',
      justifyContent: 'center',
      alignItems: 'center',
      gap: Spacing.md,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center',
      padding: Spacing.lg,
    },
    modalCard: {
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
    modalRow: {
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.sm,
    },
    modalRowActive: {
      backgroundColor: colors.primary + '18',
    },
    modalRowText: {
      fontSize: FontSize.md,
      color: colors.text,
    },
    modalRowTextActive: {
      fontWeight: '700',
      color: colors.primary,
    },
  });
}
