import {
  useState,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useLocationStore } from '@/src/stores/locationStore';
import { useAuthStore } from '@/src/stores/authStore';
import { LocationType, NearbyLocationResult } from '@/src/types';
import { addCommunityLocation, searchNearbyRootParentCandidates } from '@/src/services/locationService';

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

function firstPartOfSearch(s: string): string {
  const t = s.trim();
  if (!t) return '';
  const comma = t.indexOf(',');
  return (comma === -1 ? t : t.slice(0, comma)).trim();
}

function formatProximityKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}

function createAddLocationMapSheetStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sheetRoot: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 4,
    },
    formPanel: {
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
      maxHeight: 400,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: -2 },
      elevation: 8,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.sm,
    },
    sheetTitle: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    sheetCloseButton: {
      padding: Spacing.xs,
      marginRight: -Spacing.xs,
    },
    sheetCloseButtonPressed: {
      opacity: 0.65,
    },
    formScrollContent: {
      paddingBottom: 0,
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

export type AddLocationMapSheetRef = {
  syncNameFromSearch: (text: string) => void;
  syncNameFromMapFeature: (placeName: string) => void;
};

type Props = {
  visible: boolean;
  /** Search bar text when add mode was opened; used once to seed Name. */
  initialSearchText: string;
  pinLatitude: number;
  pinLongitude: number;
  onSaved: (locationId: string) => void;
  onRequestClose: () => void;
  /** Full height of the bottom sheet (for shrinking the map stage so the pin matches map center). */
  onSheetHeightChange?: (height: number) => void;
  onMapInteractionBlockedChange?: (blocked: boolean) => void;
};

export const AddLocationMapSheet = forwardRef<AddLocationMapSheetRef, Props>(
  function AddLocationMapSheet(
    {
      visible,
      initialSearchText,
      pinLatitude,
      pinLongitude,
      onSaved,
      onRequestClose,
      onSheetHeightChange,
      onMapInteractionBlockedChange,
    },
    ref,
  ) {
    const insets = useSafeAreaInsets();
    const { colors, resolvedScheme } = useAppTheme();
    const styles = useMemo(() => createAddLocationMapSheetStyles(colors), [colors]);
    const { user } = useAuthStore();
    const { fetchLocations, setLastAddedLocationId } = useLocationStore();
    const nameUserEditedRef = useRef(false);
    const wasVisibleRef = useRef(false);

    const [name, setName] = useState('');
    const [locationType, setLocationType] = useState<LocationType | null>(null);
    const [typePickerOpen, setTypePickerOpen] = useState(false);
    const [isPublic, setIsPublic] = useState(true);
    const [parentPickerPhase, setParentPickerPhase] = useState<'idle' | 'loading' | 'choose'>('idle');
    const [parentPickerCandidates, setParentPickerCandidates] = useState<NearbyLocationResult[]>([]);
    const [parentLinkSaving, setParentLinkSaving] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        syncNameFromSearch: (text: string) => {
          if (!nameUserEditedRef.current) setName(firstPartOfSearch(text));
        },
        syncNameFromMapFeature: (placeName: string) => {
          nameUserEditedRef.current = false;
          setName(firstPartOfSearch(placeName));
        },
      }),
      [],
    );

    useEffect(() => {
      if (!visible) {
        wasVisibleRef.current = false;
        setTypePickerOpen(false);
        setParentPickerPhase('idle');
        setParentPickerCandidates([]);
        setParentLinkSaving(false);
        return;
      }
      const opening = !wasVisibleRef.current;
      wasVisibleRef.current = true;
      if (opening) {
        nameUserEditedRef.current = false;
        setName(firstPartOfSearch(initialSearchText));
        setLocationType(null);
        setIsPublic(true);
        setParentPickerPhase('idle');
        setParentPickerCandidates([]);
        setParentLinkSaving(false);
      }
    }, [visible, initialSearchText]);

    const parentPickerOpen = parentPickerPhase !== 'idle' || parentLinkSaving;
    useEffect(() => {
      onMapInteractionBlockedChange?.(parentPickerOpen);
    }, [parentPickerOpen, onMapInteractionBlockedChange]);

    const commitNewLocation = useCallback(
      async (parentLocationId: string | null) => {
        if (!user || locationType == null) return;
        setParentLinkSaving(true);
        try {
          const newLoc = await addCommunityLocation(
            name.trim(),
            locationType,
            pinLatitude,
            pinLongitude,
            user.id,
            isPublic,
            parentLocationId,
          );
          if (newLoc) {
            await fetchLocations();
            setLastAddedLocationId(newLoc.id);
            setParentPickerPhase('idle');
            setParentPickerCandidates([]);
            onSaved(newLoc.id);
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
        pinLatitude,
        pinLongitude,
        isPublic,
        fetchLocations,
        setLastAddedLocationId,
        onSaved,
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
      if (!Number.isFinite(pinLatitude) || !Number.isFinite(pinLongitude)) {
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
            const candidates = await searchNearbyRootParentCandidates(pinLatitude, pinLongitude);
            setParentPickerCandidates(candidates);
            setParentPickerPhase('choose');
          } catch {
            setParentPickerPhase('idle');
            setParentPickerCandidates([]);
            Alert.alert('Could not continue', 'Something went wrong loading suggestions. Try again.');
          }
        })();
      });
    }, [name, locationType, pinLatitude, pinLongitude, user]);

    const closeParentPickerWithoutSaving = useCallback(() => {
      if (!parentLinkSaving) {
        setParentPickerPhase('idle');
        setParentPickerCandidates([]);
      }
    }, [parentLinkSaving]);

    const coordsOk = Number.isFinite(pinLatitude) && Number.isFinite(pinLongitude);
    const canSave = name.trim().length > 0 && coordsOk && locationType != null;
    const addLocationBlocked = !canSave || parentPickerOpen;

    if (!visible) return null;

    return (
      <>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          style={styles.sheetRoot}
          onLayout={(e) => onSheetHeightChange?.(e.nativeEvent.layout.height)}
        >
          <View style={styles.formPanel}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>New location</Text>
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  onRequestClose();
                }}
                style={({ pressed }) => [styles.sheetCloseButton, pressed && styles.sheetCloseButtonPressed]}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={26} color={colors.textSecondary} />
              </Pressable>
            </View>
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
          <View
            style={[
              styles.parentPickerFullScreen,
              { paddingTop: insets.top + Spacing.md, paddingBottom: insets.bottom + Spacing.md },
            ]}
          >
            <StatusBar style={resolvedScheme === 'dark' ? 'light' : 'dark'} />
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
                    <Pressable key={c.id} style={styles.parentLinkOption} onPress={() => commitNewLocation(c.id)}>
                      <View style={styles.parentLinkOptionText}>
                        <Text style={styles.parentLinkOptionName} numberOfLines={2}>
                          {c.name}
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
  },
);
