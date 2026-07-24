import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
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
import {
  createLocationWithOutbox,
  searchNearbyRootParentCandidates,
  rootParentCandidatesFromLocations,
  isLocalLocationId,
} from '@/src/services/locationService';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';

const WATER_TYPES: LocationType[] = ['river', 'stream', 'lake', 'reservoir', 'pond'];
function isWaterType(t: LocationType | null | undefined): boolean {
  return t != null && WATER_TYPES.includes(t);
}

/**
 * How close a known river must be for us to lead with "Adding access to {river}?".
 * Beyond this we fall back to the neutral type dropdown + post-save parent picker.
 */
const BEST_GUESS_PARENT_MAX_KM = 8;

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

/** Children don't need a name; default to "{River} access" / "{River} parking" (DB name is not-null). */
function defaultChildName(
  parentName: string | null | undefined,
  type: LocationType | null | undefined,
): string {
  const p = (parentName ?? '').trim();
  const suffix = type === 'parking' ? 'parking' : 'access';
  if (!p) return type === 'parking' ? 'Parking' : 'Access point';
  return `${p} ${suffix}`;
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
    dropdownCompactLocked: {
      opacity: 0.75,
      justifyContent: 'flex-start',
    },
    dropdownChevronCompact: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    bestGuessCard: {
      backgroundColor: colors.primary + '12',
      borderWidth: 1,
      borderColor: colors.primary + '33',
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    bestGuessHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    bestGuessTitle: {
      flex: 1,
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    bestGuessSubtitle: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 4,
    },
    bestGuessButtonRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginTop: Spacing.md,
    },
    bestGuessPrimary: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.sm,
      paddingVertical: Spacing.sm,
      alignItems: 'center',
    },
    bestGuessPrimaryText: {
      color: colors.textInverse,
      fontWeight: '700',
      fontSize: FontSize.sm,
    },
    bestGuessSecondary: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bestGuessSecondaryText: {
      color: colors.textSecondary,
      fontWeight: '600',
      fontSize: FontSize.sm,
    },
    parentChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      backgroundColor: colors.primary + '14',
      borderRadius: 999,
      paddingVertical: 5,
      paddingHorizontal: Spacing.sm,
      marginBottom: Spacing.sm,
      maxWidth: '100%',
    },
    parentChipText: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.primary,
      flexShrink: 1,
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
  onSaved?: (locationId: string) => void;
  onRequestClose: () => void;
  /** Full height of the bottom sheet (for shrinking the map stage so the pin matches map center). */
  onSheetHeightChange?: (height: number) => void;
  onMapInteractionBlockedChange?: (blocked: boolean) => void;
  /** Optional header slot (kind selector / back button) rendered in the header (from AddPlaceSheet). */
  kindSelector?: ReactNode;
  /** When set, the type is fixed (from the type rail): no type dropdown or best-guess prompt. */
  presetType?: LocationType;
  /** Water-creation mode with a water-only type dropdown (used for inline "＋ New water"). */
  waterOnly?: boolean;
  /** For access points/parking: the water this is a child of. Local ids are handled offline. */
  presetParent?: { id: string; name: string } | null;
  /** Water-creation dedup: user tapped an existing water match — add a child to it instead. */
  onPickExistingWater?: (water: Location) => void;
  /** Preferred over onSaved when set: the orchestrator decides navigation/continuation. */
  onCommitted?: (loc: Location, pending: boolean) => void;
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
  kindSelector,
  presetType,
  waterOnly,
  presetParent,
  onPickExistingWater,
  onCommitted,
}: Props) {
    // Rail-driven modes commit directly (no in-sheet type/parent decisions or best-guess).
    const railMode = presetType != null || !!waterOnly;
    const insets = useSafeAreaInsets();
    const effectiveTop = useEffectiveSafeTopInset();
    const { colors, resolvedScheme } = useAppTheme();
    const styles = useMemo(() => createAddLocationMapSheetStyles(colors), [colors]);
    const { user } = useAuthStore();
    const { setLastAddedLocationId } = useLocationStore();
    const wasVisibleRef = useRef(false);

    const [name, setName] = useState('');
    const [locationType, setLocationType] = useState<LocationType | null>(null);
    const [typePickerOpen, setTypePickerOpen] = useState(false);
    const [isPublic, setIsPublic] = useState(true);
    const [parentPickerPhase, setParentPickerPhase] = useState<'idle' | 'loading' | 'choose'>('idle');
    const [parentPickerCandidates, setParentPickerCandidates] = useState<NearbyLocationResult[]>([]);
    const [parentLinkSaving, setParentLinkSaving] = useState(false);
    // Best-guess parent-river flow. `unknown` → offer the lead card if a nearby river
    // exists; `access` → confirmed access point under `chosenParent`; `own` → brand-new water.
    const [parentChoice, setParentChoice] = useState<'unknown' | 'access' | 'own'>('unknown');
    const [bestGuessParent, setBestGuessParent] = useState<NearbyLocationResult | null>(null);
    const [chosenParent, setChosenParent] = useState<{ id: string; name: string } | null>(null);

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
        // Type is fixed when driven by the type rail; water-only defaults to river; else chosen in-sheet.
        setLocationType(presetType ?? (waterOnly ? 'river' : null));
        setIsPublic(true);
        setParentPickerPhase('idle');
        setParentPickerCandidates([]);
        setParentLinkSaving(false);
        setNameMapSuggestions([]);
        setNameMapSuggestionsLoading(false);
        if (presetParent) {
          setParentChoice('access');
          setChosenParent(presetParent);
        } else {
          setParentChoice(presetType ? 'own' : 'unknown');
          setChosenParent(null);
        }
        setBestGuessParent(null);
      }
    }, [visible, presetType, presetParent, waterOnly]);

    // Proactively look for a nearby known river so we can lead with
    // "Adding access to {river}?" — the streamlined common case. Recomputed as the
    // pin moves. Falls back to the offline catalog snapshot when the RPC is unreachable.
    useEffect(() => {
      // Not needed in rail-driven modes.
      if (railMode || !visible || !Number.isFinite(pinLatitude) || !Number.isFinite(pinLongitude)) {
        setBestGuessParent(null);
        return;
      }
      let cancelled = false;
      const timer = setTimeout(() => {
        void (async () => {
          let candidates: NearbyLocationResult[] = [];
          try {
            candidates = await searchNearbyRootParentCandidates(
              pinLatitude,
              pinLongitude,
              null,
              BEST_GUESS_PARENT_MAX_KM,
              1,
            );
          } catch {
            candidates = [];
          }
          if ((!candidates || candidates.length === 0) && user) {
            candidates = rootParentCandidatesFromLocations(
              catalogLocations,
              pinLatitude,
              pinLongitude,
              null,
              BEST_GUESS_PARENT_MAX_KM,
              1,
              user.id,
            );
          }
          if (cancelled) return;
          const nearest =
            candidates.find((c) => c.distance_km <= BEST_GUESS_PARENT_MAX_KM) ?? null;
          setBestGuessParent(nearest);
        })();
      }, 300);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }, [visible, railMode, pinLatitude, pinLongitude, catalogLocations, user]);

    // In water-creation mode, dedup the name against existing WATERS (roots) so the user
    // can attach to one instead of creating a duplicate river.
    const waterDedupMode = railMode && isWaterType(locationType) && !!onPickExistingWater;
    const catalogMatches = useMemo(() => {
      if (name.trim().length < 2) return [];
      const base = waterDedupMode
        ? catalogLocations.filter(
            (l) => l.parent_location_id == null && WATER_TYPES.includes(l.type),
          )
        : catalogLocations;
      return filterLocationsByQuery(base, name);
    }, [catalogLocations, name, waterDedupMode]);

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
          // Name is optional for access points — fall back to a generated one.
          const trimmed = name.trim();
          const finalName =
            trimmed ||
            (locationType === 'access_point' || locationType === 'parking'
              ? defaultChildName(chosenParent?.name ?? null, locationType)
              : trimmed);
          // If the parent is an offline (local) pin, reference it by client id so the
          // outbox can remap it to the server id after the parent syncs.
          const parentIsLocal = isLocalLocationId(parentLocationId);
          // Offline-capable: shows the pin immediately and queues the write when offline.
          const { location: newLoc, pending } = await createLocationWithOutbox(
            {
              name: finalName,
              type: locationType,
              latitude: pinLatitude,
              longitude: pinLongitude,
              isPublic,
              parentLocationId: parentIsLocal ? null : parentLocationId,
              parentClientId: parentIsLocal ? parentLocationId : null,
            },
            user.id,
          );
          setLastAddedLocationId(newLoc.id);
          setParentPickerPhase('idle');
          setParentPickerCandidates([]);
          if (onCommitted) {
            // Orchestrator owns navigation / continuation (e.g. inline water → access point).
            onCommitted(newLoc, pending);
          } else if (pending) {
            // Local-only for now — don't navigate to a server-backed detail page.
            onRequestClose();
            Alert.alert(
              'Saved offline',
              "This spot is on your map now and will sync automatically when you're back online.",
            );
          } else {
            onSaved?.(newLoc.id);
          }
        } catch {
          Alert.alert(
            'Could not add location',
            'Something went wrong. Check your connection, or apply the latest Supabase migrations if this database is missing columns such as locations.created_by.',
          );
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
        chosenParent,
        pinLatitude,
        pinLongitude,
        isPublic,
        setLastAddedLocationId,
        onSaved,
        onCommitted,
        onRequestClose,
      ],
    );

    const handleAddLocationPress = useCallback(() => {
      if (!user) {
        Alert.alert('Sign in required', 'Sign in to add a location.');
        return;
      }
      if (locationType == null) {
        Alert.alert('Location type', 'Choose a type for this location before adding it.');
        return;
      }
      // Access points can be nameless (auto-named); everything else needs a name.
      if (locationType !== 'access_point' && !name.trim()) {
        Alert.alert('Name needed', 'Enter a name for this location.');
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

    /** Confirm the best-guess: this is an access point under the nearby river. */
    const confirmBestGuessAccess = useCallback(() => {
      if (!bestGuessParent) return;
      setChosenParent(bestGuessParent);
      setParentChoice('access');
      setLocationType('access_point');
    }, [bestGuessParent]);

    /** Reject the best-guess: this is a brand-new water — show the full type dropdown. */
    const declineBestGuess = useCallback(() => {
      setChosenParent(null);
      setParentChoice('own');
    }, []);

    /** Undo an "access point" confirmation and reconsider. */
    const clearParentChoice = useCallback(() => {
      setChosenParent(null);
      setParentChoice('unknown');
    }, []);

    // With a parent already chosen we skip the post-save parent modal and commit directly.
    const handleSavePress = useCallback(() => {
      // Rail-driven flows commit directly — the type (and any parent) are already decided.
      if (railMode) {
        if (!user) {
          Alert.alert('Sign in required', 'Sign in to add a location.');
          return;
        }
        if (!Number.isFinite(pinLatitude) || !Number.isFinite(pinLongitude)) {
          Alert.alert('Pin location needed', 'Tap the map so the pin sits on your spot.');
          return;
        }
        const nameRequired = locationType !== 'access_point' && locationType !== 'parking';
        if (nameRequired && !name.trim()) {
          Alert.alert('Name needed', 'Enter a name for this location.');
          return;
        }
        Keyboard.dismiss();
        void commitNewLocation(presetParent?.id ?? null);
        return;
      }
      if (parentChoice === 'access' && chosenParent) {
        // Access points can be nameless — we auto-name them "{River} access".
        if (!user) {
          Alert.alert('Sign in required', 'Sign in to add a location.');
          return;
        }
        if (!Number.isFinite(pinLatitude) || !Number.isFinite(pinLongitude)) {
          Alert.alert('Pin location needed', 'Tap the map so the pin sits on your access point.');
          return;
        }
        Keyboard.dismiss();
        void commitNewLocation(chosenParent.id);
        return;
      }
      handleAddLocationPress();
    }, [
      railMode,
      locationType,
      presetParent,
      parentChoice,
      chosenParent,
      name,
      user,
      pinLatitude,
      pinLongitude,
      commitNewLocation,
      handleAddLocationPress,
    ]);

    const isChildTypeSel = locationType === 'access_point' || locationType === 'parking';
    // Rail flows fix the type up front: no best-guess card. Water-only shows a water dropdown.
    const showBestGuessCard = !railMode && parentChoice === 'unknown' && bestGuessParent != null;
    const showTypeDropdown = waterOnly
      ? true
      : !presetType && (!bestGuessParent || parentChoice === 'own');

    const coordsOk = Number.isFinite(pinLatitude) && Number.isFinite(pinLongitude);
    // Access points / parking don't require a name (auto-named); other types do.
    const nameOk = isChildTypeSel || name.trim().length > 0;
    const canSave = nameOk && coordsOk && locationType != null;
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
              {kindSelector ?? <Text style={styles.sheetTitle}>New location</Text>}
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

            {showBestGuessCard && bestGuessParent ? (
              <View style={styles.bestGuessCard}>
                <View style={styles.bestGuessHeaderRow}>
                  <Ionicons name="git-branch-outline" size={18} color={colors.primary} />
                  <Text style={styles.bestGuessTitle}>
                    Adding access to {bestGuessParent.name}?
                  </Text>
                </View>
                <Text style={styles.bestGuessSubtitle}>
                  {formatProximityKm(bestGuessParent.distance_km)} · we'll link this spot to that water
                </Text>
                <View style={styles.bestGuessButtonRow}>
                  <Pressable
                    style={styles.bestGuessPrimary}
                    onPress={confirmBestGuessAccess}
                    accessibilityRole="button"
                  >
                    <Text style={styles.bestGuessPrimaryText}>Yes, add access point</Text>
                  </Pressable>
                  <Pressable
                    style={styles.bestGuessSecondary}
                    onPress={declineBestGuess}
                    accessibilityRole="button"
                  >
                    <Text style={styles.bestGuessSecondaryText}>No — new water</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {parentChoice === 'access' && chosenParent ? (
              <View style={styles.parentChip}>
                <Ionicons name="git-branch-outline" size={15} color={colors.primary} />
                <Text style={styles.parentChipText} numberOfLines={1}>
                  {locationType === 'parking' ? 'Parking on' : 'Access point on'} {chosenParent.name}
                </Text>
                {/* In preset (type-rail) mode the header back button handles changing the water. */}
                {presetType ? null : (
                  <Pressable
                    onPress={clearParentChoice}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Change parent water"
                  >
                    <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
                  </Pressable>
                )}
              </View>
            ) : null}

            <View style={styles.nameTypeBlock}>
              <View style={styles.nameTypeRow}>
                <View style={styles.nameCol}>
                  <Text style={styles.fieldLabel}>
                    {isChildTypeSel ? 'Name (optional)' : 'Name'}
                  </Text>
                  <View ref={nameFieldWrapRef} style={styles.nameFieldWrap}>
                    <TextInput
                      style={styles.nameFieldInput}
                      placeholder={
                        isChildTypeSel
                          ? `Optional — defaults to "${defaultChildName(chosenParent?.name ?? null, locationType)}"`
                          : 'Search DriftGuide & map, or type a name…'
                      }
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
                              <Text style={styles.nameSuggestionsSectionLabel}>
                                {waterDedupMode
                                  ? 'Already on DriftGuide — tap to add access here'
                                  : 'In DriftGuide'}
                              </Text>
                              {catalogMatches.slice(0, 8).map((loc) => (
                                <Pressable
                                  key={loc.id}
                                  style={styles.nameSuggestionRow}
                                  onPress={() => {
                                    Keyboard.dismiss();
                                    setNameInputFocused(false);
                                    if (waterDedupMode && onPickExistingWater) {
                                      onPickExistingWater(loc);
                                    } else {
                                      setName(loc.name);
                                      onSelectCatalogLocation(loc);
                                    }
                                  }}
                                  accessibilityRole="button"
                                  accessibilityLabel={
                                    waterDedupMode
                                      ? `Add access to ${loc.name}`
                                      : `Center map on ${loc.name}`
                                  }
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
                {showTypeDropdown ? (
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
                ) : parentChoice === 'access' ? (
                  <View style={styles.typeCol}>
                    <Text style={styles.fieldLabelCompact}>Type</Text>
                    <View style={[styles.dropdownCompact, styles.dropdownCompactLocked]}>
                      <Text style={styles.dropdownTextCompact} numberOfLines={1}>
                        Access point
                      </Text>
                    </View>
                  </View>
                ) : null}
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
                onPress={handleSavePress}
                disabled={addLocationBlocked}
              >
                {parentPickerPhase === 'loading' || parentLinkSaving ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.saveButtonText}>
                    {locationType === 'parking'
                      ? 'Add parking'
                      : locationType === 'access_point' || parentChoice === 'access'
                        ? 'Add access point'
                        : railMode && locationType
                          ? `Add ${typeLabel(locationType).toLowerCase()}`
                          : 'Add location'}
                  </Text>
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
              <Text style={styles.modalTitle}>{waterOnly ? 'Water type' : 'Location type'}</Text>
              {(waterOnly
                ? LOCATION_TYPE_OPTIONS.filter((o) => WATER_TYPES.includes(o.value))
                : LOCATION_TYPE_OPTIONS
              ).map((opt) => (
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
