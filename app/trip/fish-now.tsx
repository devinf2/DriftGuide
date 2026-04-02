import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  TouchableOpacity,
  Switch,
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
import { addCommunityLocation, haversineDistance, searchNearbyRootParentCandidates } from '@/src/services/locationService';
import type { Location, LocationType, NearbyLocationResult } from '@/src/types';

/** If the angler is within this distance of the parent pin, start the trip on the parent (no new child row). */
const CLOSE_TO_PARENT_KM = 1.5;

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

function formatProximityKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
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

type Phase = 'locating' | 'loading_parents' | 'pick_parent' | 'details' | 'busy';

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
  /** Shown in dev when coordinates are the Provo fallback (simulator / no GPS). */
  const [devFallbackNotice, setDevFallbackNotice] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [candidates, setCandidates] = useState<NearbyLocationResult[]>([]);
  /** When continuing to details: parent id if child/standalone save, or null for standalone. */
  const [detailsParentId, setDetailsParentId] = useState<string | null>(null);
  const [detailsParentLabel, setDetailsParentLabel] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [locationType, setLocationType] = useState<LocationType | null>(null);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(true);

  useEffect(() => {
    void fetchLocations();
  }, [fetchLocations]);

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
      if (!userCoords) return;
      const d = haversineDistance(userCoords.latitude, userCoords.longitude, c.latitude, c.longitude);
      if (d <= CLOSE_TO_PARENT_KM) {
        const fromStore = locations.find((l) => l.id === c.id);
        void startOnExistingLocation(fromStore ?? nearbyResultToLocation(c));
        return;
      }
      setDetailsParentId(c.id);
      setDetailsParentLabel(c.name);
      setName('');
      setLocationType(c.type);
      setPhase('details');
    },
    [userCoords, locations, startOnExistingLocation],
  );

  const handleStandalone = useCallback(() => {
    setDetailsParentId(null);
    setDetailsParentLabel(null);
    setName('');
    setLocationType(null);
    setPhase('details');
  }, []);

  const handleBackFromDetails = useCallback(() => {
    if (phase === 'busy') return;
    setPhase('pick_parent');
    setDetailsParentId(null);
    setDetailsParentLabel(null);
  }, [phase]);

  const handleStartWithNewSpot = useCallback(async () => {
    if (!user || !userCoords) {
      Alert.alert('Sign in required', 'Sign in to start a trip.');
      return;
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
      userCoords.latitude,
      userCoords.longitude,
      user.id,
      isPublic,
      detailsParentId,
    );
    if (!newLoc) {
      setPhase('details');
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
    userCoords,
    isConnected,
    name,
    locationType,
    isPublic,
    detailsParentId,
    fetchLocations,
    addRecentLocation,
    startTrip,
    router,
  ]);

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
            onPress={() => (phase === 'details' ? handleBackFromDetails() : router.back())}
            style={({ pressed }) => [styles.headerBackPress, { opacity: pressed ? 0.65 : 1 }]}
            hitSlop={12}
            disabled={phase === 'busy'}
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

      {phase === 'details' ? (
        <ScrollView
          style={styles.detailsScroll}
          contentContainerStyle={[styles.detailsContent, { paddingBottom: insets.bottom + Spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.detailsHeadline}>Your spot</Text>
          <Text style={styles.detailsSub}>
            {detailsParentId
              ? `Saving a pin on ${detailsParentLabel ?? 'this water'} at your current location.`
              : 'Saving a new place at your current location.'}
          </Text>
          {devFallbackNotice ? <Text style={styles.devFallbackBanner}>{devFallbackNotice}</Text> : null}

          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.nameInput}
            placeholder="e.g. Riverside access"
            placeholderTextColor={colors.textTertiary}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            editable={phase !== 'busy'}
          />

          <Text style={[styles.fieldLabel, { marginTop: Spacing.md }]}>Type</Text>
          <Pressable style={styles.typeDropdown} onPress={() => setTypePickerOpen(true)} disabled={phase === 'busy'}>
            <Text style={[styles.typeDropdownText, locationType == null && styles.typeDropdownPlaceholder]}>
              {typeLabel(locationType)}
            </Text>
            <Text style={styles.typeChevron}>▾</Text>
          </Pressable>

          <View style={styles.publicRow}>
            <Text style={styles.publicLabel}>Public location</Text>
            <Switch
              value={isPublic}
              onValueChange={setIsPublic}
              disabled={phase === 'busy'}
              trackColor={{ false: colors.border, true: colors.primary + '99' }}
              thumbColor={Platform.OS === 'android' ? (isPublic ? colors.primary : colors.textTertiary) : undefined}
              ios_backgroundColor={colors.border}
            />
          </View>

          <Pressable
            style={[styles.primaryBtn, phase === 'busy' && styles.primaryBtnDisabled]}
            onPress={() => void handleStartWithNewSpot()}
            disabled={phase === 'busy'}
          >
            {phase === 'busy' ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.primaryBtnText}>Start fishing</Text>
            )}
          </Pressable>
        </ScrollView>
      ) : (
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
          {phase === 'pick_parent' && userCoords != null ? (
            <ScrollView
              style={styles.pickerScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.pickerScrollContent}
            >
              <Text style={styles.pickerTitle}>Part of an existing place?</Text>
              <Text style={styles.pickerSubtitle}>
                Nothing is saved yet. If this spot belongs inside a larger waterbody we already have, choose it.
                Otherwise save it as its own place.
              </Text>
              {candidates.length > 0
                ? candidates.map((c) => (
                    <Pressable
                      key={c.id}
                      style={styles.parentRow}
                      onPress={() => handlePickParent(c)}
                      disabled={phase === 'busy'}
                    >
                      <View style={styles.parentRowText}>
                        <Text style={styles.parentRowName} numberOfLines={2}>
                          Part of {c.name}
                        </Text>
                        <Text style={styles.parentRowMeta}>{formatProximityKm(c.distance_km)}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                    </Pressable>
                  ))
                : null}
              <Pressable style={styles.declineBtn} onPress={handleStandalone} disabled={phase === 'busy'}>
                <Text style={styles.declineBtnText}>No — save as its own place</Text>
              </Pressable>
            </ScrollView>
          ) : null}
          {phase === 'busy' && userCoords != null ? (
            <View style={styles.busyOverlay}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={styles.loadingCaption}>Starting your trip…</Text>
            </View>
          ) : null}
        </View>
      )}

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
    pickerScroll: {
      flex: 1,
    },
    pickerScrollContent: {
      paddingBottom: Spacing.lg,
    },
    pickerTitle: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
      marginBottom: Spacing.sm,
    },
    pickerSubtitle: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: Spacing.md,
    },
    parentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: Spacing.sm,
    },
    parentRowText: {
      flex: 1,
      minWidth: 0,
    },
    parentRowName: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.text,
    },
    parentRowMeta: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 2,
    },
    declineBtn: {
      marginTop: Spacing.sm,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    declineBtnText: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.textSecondary,
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
    detailsScroll: {
      flex: 1,
    },
    detailsContent: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.lg,
    },
    detailsHeadline: {
      fontSize: FontSize.xl,
      fontWeight: '700',
      color: colors.text,
    },
    detailsSub: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginTop: Spacing.sm,
      marginBottom: Spacing.lg,
    },
    fieldLabel: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: Spacing.xs,
    },
    nameInput: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
    },
    typeDropdown: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    typeDropdownText: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.text,
      flex: 1,
    },
    typeDropdownPlaceholder: {
      color: colors.textTertiary,
      fontWeight: '500',
    },
    typeChevron: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    publicRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: Spacing.lg,
    },
    publicLabel: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
      flex: 1,
      marginRight: Spacing.sm,
    },
    primaryBtn: {
      marginTop: Spacing.xl,
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
      alignItems: 'center',
    },
    primaryBtnDisabled: {
      opacity: 0.7,
    },
    primaryBtnText: {
      color: colors.textInverse,
      fontSize: FontSize.md,
      fontWeight: '700',
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
