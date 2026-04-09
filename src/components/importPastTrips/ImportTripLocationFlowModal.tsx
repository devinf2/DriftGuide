import {
  LocationPinParentTwoStepFlow,
  type PinParentFlowStep,
} from '@/src/components/location/LocationPinParentTwoStepFlow';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useLocationStore } from '@/src/stores/locationStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import {
  addCommunityLocation,
  haversineDistance,
  isWithinPinParentReuseThreshold,
} from '@/src/services/locationService';
import type { Location, LocationType, NearbyLocationResult } from '@/src/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const CANDIDATE_PRESS_ENABLE_DELAY_MS = 320;

const LOCATION_TYPE_OPTIONS: { value: LocationType; label: string }[] = [
  { value: 'river', label: 'River' },
  { value: 'stream', label: 'Stream' },
  { value: 'lake', label: 'Lake' },
  { value: 'reservoir', label: 'Reservoir' },
  { value: 'pond', label: 'Pond' },
  { value: 'access_point', label: 'Access point' },
  { value: 'parking', label: 'Parking' },
];

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

function typeLabel(t: LocationType | null): string {
  if (t == null) return 'Select type';
  return LOCATION_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

const SHEET_HEIGHT_RATIO = 0.82;

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    bottomBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    kavOuter: {
      width: '100%',
    },
    sheet: {
      width: '100%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      overflow: 'hidden',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.15,
          shadowRadius: 8,
        },
        android: { elevation: 16 },
        default: {},
      }),
    },
    sheetContent: {
      flex: 1,
      minHeight: 0,
    },
    loading: {
      flex: 1,
      minHeight: 220,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
    },
    loadingText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: Spacing.md,
    },
    cancelText: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.textSecondary,
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
    modalRowActive: { backgroundColor: colors.primary + '18' },
    modalRowText: { fontSize: FontSize.md, color: colors.text },
    modalRowTextActive: { fontWeight: '700', color: colors.primary },
  });
}

type Props = {
  visible: boolean;
  onClose: () => void;
  candidates: NearbyLocationResult[];
  loading: boolean;
  anchorLat: number | null;
  anchorLng: number | null;
  userId: string | null;
  isConnected: boolean;
  onComplete: (loc: Location, locationId: string) => void;
  onLocationCreated?: () => void;
};

export function ImportTripLocationFlowModal({
  visible,
  onClose,
  candidates: nearbyFromServer,
  loading,
  anchorLat,
  anchorLng,
  userId,
  isConnected,
  onComplete,
  onLocationCreated,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { locations, fetchLocations } = useLocationStore();

  const sheetHeight = useMemo(
    () => Math.round(windowHeight * SHEET_HEIGHT_RATIO),
    [windowHeight],
  );

  const mapFixedHeight = useMemo(
    () => Math.round(Math.min(260, Math.max(180, sheetHeight * 0.36))),
    [sheetHeight],
  );

  const [flowStep, setFlowStep] = useState<PinParentFlowStep>(1);
  const [candidateRowsEnabled, setCandidateRowsEnabled] = useState(false);
  const [mapFocusNonce, setMapFocusNonce] = useState(0);
  const createFormInitRef = useRef(false);
  const autoSkippedPickParentRef = useRef(false);

  const [pinLat, setPinLat] = useState(40.76);
  const [pinLng, setPinLng] = useState(-111.891);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [locationType, setLocationType] = useState<LocationType | null>(null);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [isPublic, setIsPublic] = useState(true);

  const anchorOk = anchorLat != null && anchorLng != null && Number.isFinite(anchorLat) && Number.isFinite(anchorLng);

  useEffect(() => {
    if (visible) void fetchLocations();
  }, [visible, fetchLocations]);

  useEffect(() => {
    if (!visible) {
      setFlowStep(1);
      setSaving(false);
      setName('');
      setLocationType(null);
      setTypePickerOpen(false);
      setIsPublic(true);
      createFormInitRef.current = false;
      autoSkippedPickParentRef.current = false;
      return;
    }
    setFlowStep(1);
    setSaving(false);
    setName('');
    setLocationType(null);
    setTypePickerOpen(false);
    setIsPublic(true);
    createFormInitRef.current = false;
    autoSkippedPickParentRef.current = false;
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (anchorOk && anchorLat != null && anchorLng != null) {
      setPinLat(anchorLat);
      setPinLng(anchorLng);
    } else {
      setPinLat(40.76);
      setPinLng(-111.891);
    }
    setMapFocusNonce((n) => n + 1);
  }, [visible, anchorOk, anchorLat, anchorLng]);

  useEffect(() => {
    if (!visible) {
      setCandidateRowsEnabled(false);
      return;
    }
    if (loading || nearbyFromServer.length === 0) {
      setCandidateRowsEnabled(true);
      return;
    }
    setCandidateRowsEnabled(false);
    const t = setTimeout(() => setCandidateRowsEnabled(true), CANDIDATE_PRESS_ENABLE_DELAY_MS);
    return () => clearTimeout(t);
  }, [visible, loading, nearbyFromServer.length]);

  useEffect(() => {
    if (flowStep !== 2) {
      createFormInitRef.current = false;
      return;
    }
    if (createFormInitRef.current) return;
    createFormInitRef.current = true;
    setLocationType(null);
  }, [flowStep]);

  useEffect(() => {
    if (!visible || loading) return;
    if (nearbyFromServer.length > 0) return;
    if (autoSkippedPickParentRef.current) return;
    autoSkippedPickParentRef.current = true;
    setFlowStep(2);
  }, [visible, loading, nearbyFromServer.length]);

  /** List row / catalog pin: within 1 mi of photo GPS → attach that place; farther → ask. */
  const handlePickCandidate = useCallback(
    (c: NearbyLocationResult) => {
      if (
        !anchorOk ||
        anchorLat == null ||
        anchorLng == null ||
        isWithinPinParentReuseThreshold(anchorLat, anchorLng, c.latitude, c.longitude)
      ) {
        onComplete(nearbyResultToLocation(c), c.id);
        onClose();
        return;
      }
      const km = haversineDistance(anchorLat, anchorLng, c.latitude, c.longitude);
      const mi = km * 0.621371;
      const miRounded = mi >= 10 ? Math.round(mi) : Math.round(mi * 10) / 10;
      const placeLabel = c.name.length > 40 ? `${c.name.slice(0, 37)}…` : c.name;
      Alert.alert(
        'Photo location is farther than 1 mile away',
        `Your photos are about ${miRounded} mi from “${placeLabel}”. Use this catalog place for the import, or save the map pin (photo location) as a new spot.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Use this place',
            onPress: () => {
              onComplete(nearbyResultToLocation(c), c.id);
              onClose();
            },
          },
          {
            text: 'Save as new spot',
            style: 'default',
            onPress: () => setFlowStep(2),
          },
        ],
      );
    },
    [anchorOk, anchorLat, anchorLng, onComplete, onClose],
  );

  const handleStandalone = useCallback(() => {
    if (!userId) {
      Alert.alert('Sign in required', 'Sign in to save a new place for this import.');
      return;
    }
    setFlowStep(2);
  }, [userId]);

  const handleStep2Back = useCallback(() => {
    if (saving) return;
    setFlowStep(1);
    createFormInitRef.current = false;
  }, [saving]);

  const handleFormSubmit = useCallback(async () => {
    if (!userId) return;
    if (!Number.isFinite(pinLat) || !Number.isFinite(pinLng)) return;

    if (!isConnected) {
      Alert.alert('Offline', 'Saving a new place requires a connection.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Name needed', 'Enter a name for this spot.');
      return;
    }
    if (locationType == null) {
      Alert.alert('Location type', 'Choose a type before continuing.');
      return;
    }
    setSaving(true);
    try {
      const newLoc = await addCommunityLocation(
        name.trim(),
        locationType,
        pinLat,
        pinLng,
        userId,
        isPublic,
        null,
      );
      if (!newLoc) {
        Alert.alert(
          'Could not save spot',
          'Check your connection. If this keeps happening, confirm your Supabase migrations are up to date.',
        );
        return;
      }
      onLocationCreated?.();
      onComplete(newLoc, newLoc.id);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [
    userId,
    pinLat,
    pinLng,
    isConnected,
    name,
    locationType,
    isPublic,
    onComplete,
    onClose,
    onLocationCreated,
  ]);

  const step1EmptyHint =
    !loading && nearbyFromServer.length === 0
      ? anchorOk
        ? 'No nearby locations found. You can still save this trip as its own place using the map pin from your photos (or add places from the Map tab).'
        : 'No photo location to search from. Use search below or move the map pin, then save this trip as its own place (or pick from the Map tab).'
      : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.bottomBackdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kavOuter}
          keyboardVerticalOffset={0}
          pointerEvents="box-none"
        >
          <Pressable
            style={[styles.sheet, { height: sheetHeight, paddingBottom: insets.bottom }]}
            onPress={(e) => e.stopPropagation()}
          >
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={styles.loadingText}>Finding nearby waters…</Text>
              </View>
            ) : (
              <View style={styles.sheetContent}>
                <LocationPinParentTwoStepFlow
                  latitude={pinLat}
                  longitude={pinLng}
                  onCoordinateChange={(lat, lng) => {
                    setPinLat(lat);
                    setPinLng(lng);
                  }}
                  mapFocusKey={mapFocusNonce}
                  mapFallbackCenter={
                    anchorOk && anchorLat != null && anchorLng != null
                      ? [anchorLng, anchorLat]
                      : undefined
                  }
                  mapFixedHeight={mapFixedHeight}
                  bottomPanelFlex={1}
                  edgeToEdgeMap={false}
                  containerStyle={{ flex: 1, minHeight: 0 }}
                  step={flowStep}
                  candidates={nearbyFromServer}
                  onPressCandidate={handlePickCandidate}
                  notPartOfListLabel="No — save as its own place"
                  onPressNotPartOfList={handleStandalone}
                  step1EmptyHint={step1EmptyHint}
                  step1CandidatesDisabled={!candidateRowsEnabled && nearbyFromServer.length > 0}
                  driftGuideSearchLocations={locations}
                  searchProximityLngLat={
                    anchorOk && anchorLng != null && anchorLat != null ? [anchorLng, anchorLat] : null
                  }
                  onPickMapGeocodeResult={(f) => {
                    const [lng, lat] = f.center;
                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                      setPinLat(lat);
                      setPinLng(lng);
                      setMapFocusNonce((n) => n + 1);
                    }
                  }}
                  showSpotDetailFields={true}
                  name={name}
                  onNameChange={setName}
                  locationType={locationType}
                  typeLabel={typeLabel}
                  onPressOpenTypePicker={() => setTypePickerOpen(true)}
                  isPublic={isPublic}
                  onIsPublicChange={setIsPublic}
                  primaryButtonLabel="Save and use for import"
                  onPressPrimary={() => void handleFormSubmit()}
                  primaryBusy={saving}
                  interactionDisabled={saving}
                  onPressStep2Back={nearbyFromServer.length > 0 ? handleStep2Back : undefined}
                  bottomInsetPadding={Spacing.sm}
                  step1ListSurface="canvas"
                  primaryButtonPlacement="footer"
                />
              </View>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>

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
                  style={[styles.modalRowText, locationType === opt.value && styles.modalRowTextActive]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </Modal>
  );
}
