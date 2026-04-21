import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useLocationStore } from '@/src/stores/locationStore';
import { useAuthStore } from '@/src/stores/authStore';
import { MAPBOX_ACCESS_TOKEN } from '@/src/constants/mapbox';
import { forwardGeocode, type MapboxGeocodeFeature } from '@/src/services/mapboxGeocoding';
import { LocationType, NearbyLocationResult, type Location } from '@/src/types';
import { addCommunityLocation, searchNearbyRootParentCandidates } from '@/src/services/locationService';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';

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

function catalogLocationSubtitle(loc: Location): string {
  const type = typeLabel(loc.type);
  const status =
    loc.status === 'verified'
      ? 'Verified'
      : loc.status === 'community'
        ? 'Community'
        : loc.status === 'pending'
          ? 'Pending'
          : '';
  const usage =
    typeof loc.usage_count === 'number' && loc.usage_count > 0
      ? `${loc.usage_count} ${loc.usage_count === 1 ? 'visit' : 'visits'}`
      : '';
  return [type, status, usage].filter(Boolean).join(' · ');
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
      overflow: 'visible',
    },
    formPanel: {
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
      maxHeight: 480,
      overflow: 'visible',
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
    nameTypeBlock: {
      position: 'relative',
      zIndex: 20,
      marginBottom: Spacing.sm,
    },
    nameTypeRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      alignItems: 'flex-start',
    },
    nameCol: {
      flex: 1,
      minWidth: 0,
      zIndex: 2,
    },
    typeCol: {
      width: 118,
      flexShrink: 0,
      zIndex: 0,
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
    nameFieldWrap: {
      position: 'relative',
      zIndex: 30,
    },
    /** Floated list: does not affect layout height of the sheet. */
    nameSuggestionsWrapBase: {
      position: 'absolute',
      left: 0,
      right: 0,
      maxHeight: 220,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
      zIndex: 40,
      elevation: 12,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    nameSuggestionsAbove: {
      bottom: '100%',
      marginBottom: Spacing.xs,
    },
    nameSuggestionsBelow: {
      top: '100%',
      marginTop: Spacing.xs,
    },
    nameSuggestionsScroll: {
      maxHeight: 220,
    },
    nameSuggestionsSectionLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: Spacing.sm,
      paddingTop: Spacing.xs,
      paddingBottom: 2,
    },
    nameSuggestionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: 8,
      paddingHorizontal: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
    },
    nameSuggestionTextCol: {
      flex: 1,
      minWidth: 0,
    },
    nameSuggestionTitle: {
      fontSize: FontSize.sm,
      color: colors.text,
      fontWeight: '600',
    },
    nameSuggestionSub: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 2,
    },
    nameSuggestionsLoadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.sm,
    },
    nameSuggestionsLoadingText: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
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

type Props = {
  visible: boolean;
  pinLatitude: number;
  pinLongitude: number;
  /** Catalog locations to search (same pool as map pins). */
  catalogLocations: Location[];
  /** Mapbox forward-geocode bias `[lng, lat]`. */
  geocodeProximity: [number, number];
  onApplyGeocodeFeature: (feature: MapboxGeocodeFeature) => void;
  /** User chose an existing catalog row — center map on that place and keep adding. */
  onSelectCatalogLocation: (location: Location) => void;
  onSaved: (locationId: string) => void;
  onRequestClose: () => void;
  /** Full height of the bottom sheet (for shrinking the map stage so the pin matches map center). */
  onSheetHeightChange?: (height: number) => void;
  onMapInteractionBlockedChange?: (blocked: boolean) => void;
};

export function AddLocationMapSheet({
  visible,
  pinLatitude,
  pinLongitude,
  catalogLocations,
  geocodeProximity,
  onApplyGeocodeFeature,
  onSelectCatalogLocation,
  onSaved,
  onRequestClose,
  onSheetHeightChange,
  onMapInteractionBlockedChange,
}: Props) {
    const insets = useSafeAreaInsets();
    const effectiveTop = useEffectiveSafeTopInset();
    const { colors, resolvedScheme } = useAppTheme();
    const styles = useMemo(() => createAddLocationMapSheetStyles(colors), [colors]);
    const { user } = useAuthStore();
    const { fetchLocations, setLastAddedLocationId } = useLocationStore();
    const wasVisibleRef = useRef(false);

    const [name, setName] = useState('');
    const [locationType, setLocationType] = useState<LocationType | null>(null);
    const [typePickerOpen, setTypePickerOpen] = useState(false);
    const [isPublic, setIsPublic] = useState(true);
    const [parentPickerPhase, setParentPickerPhase] = useState<'idle' | 'loading' | 'choose'>('idle');
    const [parentPickerCandidates, setParentPickerCandidates] = useState<NearbyLocationResult[]>([]);
    const [parentLinkSaving, setParentLinkSaving] = useState(false);

    const nameSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const nameFieldWrapRef = useRef<View>(null);
    const [nameInputFocused, setNameInputFocused] = useState(false);
    const [nameMapSuggestions, setNameMapSuggestions] = useState<MapboxGeocodeFeature[]>([]);
    const [nameMapSuggestionsLoading, setNameMapSuggestionsLoading] = useState(false);
    /** Open the floated list toward the map (above) when there is room; otherwise open downward over the form. */
    const [suggestionsOpenAbove, setSuggestionsOpenAbove] = useState(true);

    useEffect(() => {
      if (!visible) {
        wasVisibleRef.current = false;
        setTypePickerOpen(false);
        setParentPickerPhase('idle');
        setParentPickerCandidates([]);
        setParentLinkSaving(false);
        setNameMapSuggestions([]);
        setNameMapSuggestionsLoading(false);
        setNameInputFocused(false);
        return;
      }
      const opening = !wasVisibleRef.current;
      wasVisibleRef.current = true;
      if (opening) {
        setName('');
        setLocationType(null);
        setIsPublic(true);
        setParentPickerPhase('idle');
        setParentPickerCandidates([]);
        setParentLinkSaving(false);
        setNameMapSuggestions([]);
        setNameMapSuggestionsLoading(false);
      }
    }, [visible]);

    const catalogMatches = useMemo(
      () =>
        name.trim().length >= 2 ? filterLocationsByQuery(catalogLocations, name) : [],
      [catalogLocations, name],
    );

    const showNameSuggestions =
      nameInputFocused &&
      name.trim().length >= 2 &&
      (nameMapSuggestionsLoading ||
        nameMapSuggestions.length > 0 ||
        catalogMatches.length > 0);

    useLayoutEffect(() => {
      if (!showNameSuggestions) return;
      nameFieldWrapRef.current?.measureInWindow((_x, y) => {
        const minAbove = 160;
        setSuggestionsOpenAbove(y >= minAbove + 8);
      });
    }, [showNameSuggestions]);

    useEffect(() => {
      if (!visible || !nameInputFocused || name.trim().length < 2) {
        setNameMapSuggestions([]);
        setNameMapSuggestionsLoading(false);
        return;
      }
      if (!MAPBOX_ACCESS_TOKEN) {
        setNameMapSuggestions([]);
        setNameMapSuggestionsLoading(false);
        return;
      }
      clearTimeout(nameSearchDebounceRef.current);
      nameSearchDebounceRef.current = setTimeout(() => {
        void (async () => {
          setNameMapSuggestionsLoading(true);
          try {
            const { features } = await forwardGeocode(name.trim(), {
              proximity: geocodeProximity,
              limit: 5,
            });
            setNameMapSuggestions(features);
          } catch {
            setNameMapSuggestions([]);
          } finally {
            setNameMapSuggestionsLoading(false);
          }
        })();
      }, 380);
      return () => clearTimeout(nameSearchDebounceRef.current);
    }, [name, nameInputFocused, visible, geocodeProximity]);

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
            <View style={styles.nameTypeBlock}>
              <View style={styles.nameTypeRow}>
                <View style={styles.nameCol}>
                  <Text style={styles.fieldLabel}>Name</Text>
                  <View ref={nameFieldWrapRef} style={styles.nameFieldWrap}>
                    <TextInput
                      style={styles.nameFieldInput}
                      placeholder="Search DriftGuide & map, or type a name…"
                      placeholderTextColor={colors.textTertiary}
                      value={name}
                      onChangeText={setName}
                      onFocus={() => setNameInputFocused(true)}
                      onBlur={() => {
                        setTimeout(() => setNameInputFocused(false), 200);
                      }}
                      returnKeyType="done"
                      autoCorrect={false}
                      autoCapitalize="sentences"
                    />
                    {showNameSuggestions ? (
                      <View
                        style={[
                          styles.nameSuggestionsWrapBase,
                          suggestionsOpenAbove
                            ? styles.nameSuggestionsAbove
                            : styles.nameSuggestionsBelow,
                        ]}
                      >
                        <ScrollView
                          style={styles.nameSuggestionsScroll}
                          keyboardShouldPersistTaps="handled"
                          nestedScrollEnabled
                          showsVerticalScrollIndicator={false}
                        >
                          {catalogMatches.length > 0 ? (
                            <>
                              <Text style={styles.nameSuggestionsSectionLabel}>In DriftGuide</Text>
                              {catalogMatches.slice(0, 8).map((loc) => (
                                <Pressable
                                  key={loc.id}
                                  style={styles.nameSuggestionRow}
                                  onPress={() => {
                                    setName(loc.name);
                                    Keyboard.dismiss();
                                    setNameInputFocused(false);
                                    onSelectCatalogLocation(loc);
                                  }}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Center map on ${loc.name}`}
                                >
                                  <Ionicons name="location" size={18} color={colors.primary} />
                                  <View style={styles.nameSuggestionTextCol}>
                                    <Text style={styles.nameSuggestionTitle} numberOfLines={2}>
                                      {loc.name}
                                    </Text>
                                    <View
                                      style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: 4,
                                        marginTop: 2,
                                      }}
                                    >
                                      <Ionicons name="star" size={12} color={colors.warning} />
                                      <Text style={styles.nameSuggestionSub}>
                                        In DriftGuide · {catalogLocationSubtitle(loc)}
                                      </Text>
                                    </View>
                                  </View>
                                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                                </Pressable>
                              ))}
                            </>
                          ) : null}
                          {nameMapSuggestionsLoading ? (
                            <View style={styles.nameSuggestionsLoadingRow}>
                              <ActivityIndicator size="small" color={colors.primary} />
                              <Text style={styles.nameSuggestionsLoadingText}>Searching map…</Text>
                            </View>
                          ) : null}
                          {!nameMapSuggestionsLoading && nameMapSuggestions.length > 0 ? (
                            <>
                              <Text style={styles.nameSuggestionsSectionLabel}>Map suggestions</Text>
                              {nameMapSuggestions.map((f) => (
                                <Pressable
                                  key={f.id}
                                  style={styles.nameSuggestionRow}
                                  onPress={() => {
                                    setName(firstPartOfSearch(f.place_name));
                                    onApplyGeocodeFeature(f);
                                    Keyboard.dismiss();
                                    setNameInputFocused(false);
                                  }}
                                  accessibilityRole="button"
                                  accessibilityLabel={f.place_name}
                                >
                                  <Ionicons name="location-outline" size={18} color={colors.primary} />
                                  <View style={styles.nameSuggestionTextCol}>
                                    <Text style={styles.nameSuggestionTitle} numberOfLines={3}>
                                      {f.place_name}
                                    </Text>
                                  </View>
                                </Pressable>
                              ))}
                            </>
                          ) : null}
                        </ScrollView>
                      </View>
                    ) : null}
                  </View>
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
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.formScrollContent}
            >
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
              { paddingTop: effectiveTop + Spacing.md, paddingBottom: insets.bottom + Spacing.md },
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
}
