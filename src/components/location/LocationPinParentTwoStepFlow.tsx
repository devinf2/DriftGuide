import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Switch,
  Platform,
  ActivityIndicator,
  Keyboard,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme, type ResolvedScheme } from '@/src/theme/ThemeProvider';
import { CatchPinPickerMap } from '@/src/components/map/CatchPinPickerMap';
import { useMapStyleLocationSearch } from '@/src/hooks/useMapStyleLocationSearch';
import type { MapboxGeocodeFeature } from '@/src/services/mapboxGeocoding';
import {
  PARENT_CANDIDATE_MAX_RADIUS_KM,
  PIN_PARENT_MAP_ROOT_CAP,
} from '@/src/constants/locationThresholds';
import { haversineDistance } from '@/src/services/locationService';
import type { Location, LocationType, NearbyLocationResult } from '@/src/types';
import { activeLocationsOnly } from '@/src/utils/locationVisibility';

export type PinParentFlowStep = 1 | 2;

export const DEFAULT_PIN_PARENT_STEP1_TITLE = 'Where are you fishing?';

export type LocationPinParentTwoStepFlowProps = {
  latitude: number;
  longitude: number;
  onCoordinateChange: (lat: number, lng: number) => void;
  mapFocusKey: number;
  mapFallbackCenter?: [number, number];
  /** Vertical flex weight for the map (default 1). Smaller = shorter map. */
  mapFlex?: number;
  /** Vertical flex weight for the bottom panel (default 1). */
  bottomPanelFlex?: number;
  /**
   * Fixed map height (e.g. compact centered modal). When set, `mapFlex` is ignored for the map block.
   */
  mapFixedHeight?: number;

  step: PinParentFlowStep;
  step1Title?: string;
  /** Optional helper line under the title (hidden when omitted). */
  step1Subtitle?: string;
  candidates: NearbyLocationResult[];
  onPressCandidate: (c: NearbyLocationResult) => void;
  notPartOfListLabel: string;
  onPressNotPartOfList: () => void;

  showSpotDetailFields: boolean;
  name: string;
  onNameChange: (v: string) => void;
  locationType: LocationType | null;
  typeLabel: (t: LocationType | null) => string;
  onPressOpenTypePicker: () => void;
  isPublic: boolean;
  onIsPublicChange: (v: boolean) => void;
  primaryButtonLabel: string;
  onPressPrimary: () => void;
  primaryBusy?: boolean;
  interactionDisabled?: boolean;

  /** Added to ScrollView content bottom (safe area). */
  bottomInsetPadding: number;

  /**
   * When true (default), map extends to screen edges (matches Fish now with outer horizontal padding).
   * Set false inside padded sheets/modals.
   */
  edgeToEdgeMap?: boolean;
  /** Shown on step 1 when there are no candidates (e.g. import empty state). */
  step1EmptyHint?: string | null;
  /** Optional back control on step 2 (e.g. import modal; Fish now uses screen header). */
  onPressStep2Back?: () => void;
  /** When true, step 1 list rows are disabled but “not part of” stays enabled (e.g. map settle delay). */
  step1CandidatesDisabled?: boolean;
  /** Merged into the outer column (e.g. `{ flex: 1, minHeight: 0 }` inside a fixed-height modal). */
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * `canvas` — rows use app background color (better contrast on a surface-colored mini modal).
   * `surface` — rows match card surface (default; full-screen Fish now).
   */
  step1ListSurface?: 'surface' | 'canvas';

  /**
   * Map-tab parity search (In DriftGuide + Map suggestions). Pass `locations` from the store;
   * omit to hide the field.
   */
  driftGuideSearchLocations?: Location[] | null;
  /** Mapbox `proximity` as [lng, lat] — e.g. GPS or photo anchor. */
  searchProximityLngLat?: [number, number] | null;
  /** After picking a Map suggestion: recenters pin; flow fills the search field like the Map tab. */
  onPickMapGeocodeResult?: (feature: MapboxGeocodeFeature) => void;

  /**
   * `inScroll` (default) — step-2 primary CTA inside the scroll panel (Fish now).
   * `footer` — primary CTA fixed under the scroll panel (e.g. import sheet replaces separate Cancel row).
   */
  primaryButtonPlacement?: 'inScroll' | 'footer';
};

function locationToNearbyCandidate(
  loc: Location,
  refLat: number,
  refLng: number,
): NearbyLocationResult | null {
  if (loc.latitude == null || loc.longitude == null) return null;
  return {
    id: loc.id,
    name: loc.name,
    type: loc.type,
    latitude: loc.latitude,
    longitude: loc.longitude,
    status: loc.status || 'verified',
    distance_km: haversineDistance(refLat, refLng, loc.latitude, loc.longitude),
    name_similarity: 0,
  };
}

/**
 * Map with center pin on top; bottom half switches between
 * (1) nearby parent waterbodies + “not part of” action and
 * (2) optional new-spot fields + primary CTA.
 *
 * Intended for Fish now and import-past-trips location attachment.
 */
export function LocationPinParentTwoStepFlow({
  latitude,
  longitude,
  onCoordinateChange,
  mapFocusKey,
  mapFallbackCenter,
  mapFlex = 1,
  bottomPanelFlex = 1,
  mapFixedHeight,
  step,
  step1Title = DEFAULT_PIN_PARENT_STEP1_TITLE,
  step1Subtitle,
  candidates,
  onPressCandidate,
  notPartOfListLabel,
  onPressNotPartOfList,
  showSpotDetailFields,
  name,
  onNameChange,
  locationType,
  typeLabel,
  onPressOpenTypePicker,
  isPublic,
  onIsPublicChange,
  primaryButtonLabel,
  onPressPrimary,
  primaryBusy = false,
  interactionDisabled = false,
  bottomInsetPadding,
  edgeToEdgeMap = true,
  step1EmptyHint,
  onPressStep2Back,
  step1CandidatesDisabled = false,
  containerStyle,
  step1ListSurface = 'surface',
  driftGuideSearchLocations = null,
  searchProximityLngLat = null,
  onPickMapGeocodeResult,
  primaryButtonPlacement = 'inScroll',
}: LocationPinParentTwoStepFlowProps) {
  const { colors, resolvedScheme } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, resolvedScheme), [colors, resolvedScheme]);
  const busy = primaryBusy || interactionDisabled;
  const rowDisabled = busy || step1CandidatesDisabled;
  const [highlightCatalogPinId, setHighlightCatalogPinId] = useState<string | null>(null);

  const driftSearchEnabled = driftGuideSearchLocations != null;
  const mapSearch = useMapStyleLocationSearch(
    driftGuideSearchLocations ?? [],
    searchProximityLngLat ?? null,
    driftSearchEnabled,
  );

  /** Anchor for radius filter: photo/GPS fallback center, else current pin (matches Fish now / import). */
  const anchorLng = mapFallbackCenter?.[0] ?? longitude;
  const anchorLat = mapFallbackCenter?.[1] ?? latitude;

  const mapPins = useMemo(() => {
    const merge = new Map<string, NearbyLocationResult>();
    for (const c of candidates) {
      merge.set(c.id, c);
    }
    for (const loc of activeLocationsOnly(driftGuideSearchLocations ?? [])) {
      if (loc.latitude == null || loc.longitude == null) continue;
      const n = locationToNearbyCandidate(loc, anchorLat, anchorLng);
      if (!n) continue;
      if (n.distance_km > PARENT_CANDIDATE_MAX_RADIUS_KM) continue;
      if (!merge.has(n.id)) merge.set(n.id, n);
    }
    return Array.from(merge.values())
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, PIN_PARENT_MAP_ROOT_CAP);
  }, [candidates, driftGuideSearchLocations, anchorLat, anchorLng]);

  const columnStyle = edgeToEdgeMap ? [styles.column, { marginHorizontal: -Spacing.lg }] : styles.column;
  const mapSectionStyle =
    mapFixedHeight != null
      ? [styles.mapSection, { height: mapFixedHeight, flex: 0 }]
      : [styles.mapSection, { flex: mapFlex }];
  const listRowBg = step1ListSurface === 'canvas' ? colors.background : colors.surface;

  const primaryInScroll = step === 2 && primaryButtonPlacement !== 'footer';
  const primaryInFooter = step === 2 && primaryButtonPlacement === 'footer';

  const primaryButtonEl = (
    <Pressable
      style={[
        styles.primaryBtn,
        primaryInFooter && styles.primaryBtnFooter,
        busy && styles.primaryBtnDisabled,
      ]}
      onPress={onPressPrimary}
      disabled={busy}
    >
      {primaryBusy ? (
        <ActivityIndicator color={colors.textInverse} />
      ) : (
        <Text style={styles.primaryBtnText}>{primaryButtonLabel}</Text>
      )}
    </Pressable>
  );

  return (
    <View style={[columnStyle, containerStyle]}>
      <View style={mapSectionStyle}>
        <View style={styles.mapWrap}>
          <CatchPinPickerMap
            latitude={latitude}
            longitude={longitude}
            onCoordinateChange={onCoordinateChange}
            interactionMode="pan_center"
            showZoomControls
            focusRequestKey={mapFocusKey}
            mapFallbackCenter={mapFallbackCenter}
            showBasemapSwitcher={false}
            showHint={false}
            containerStyle={styles.mapInner}
            catalogMarkers={
              mapPins.length > 0
                ? mapPins.map((c) => ({
                    id: c.id,
                    latitude: c.latitude,
                    longitude: c.longitude,
                    name: c.name,
                  }))
                : undefined
            }
            onCatalogMarkerPress={
              mapPins.length > 0
                ? (id) => {
                    setHighlightCatalogPinId(id);
                    const c = mapPins.find((x) => x.id === id);
                    if (c) onPressCandidate(c);
                  }
                : undefined
            }
            selectedCatalogMarkerId={highlightCatalogPinId}
          />
        </View>
      </View>
      <ScrollView
        style={[styles.panelScroll, { flex: bottomPanelFlex }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.panelContent,
          { paddingHorizontal: Spacing.lg, paddingBottom: bottomInsetPadding },
        ]}
      >
        {driftSearchEnabled ? (
          <View style={styles.mapSearchBlock}>
            <TextInput
              style={[
                styles.mapSearchInput,
                mapSearch.searchAtRest
                  ? styles.mapSearchInputIdle
                  : mapSearch.searchInputFocused
                    ? styles.mapSearchInputEditing
                    : styles.mapSearchInputFilled,
                !mapSearch.searchAtRest && styles.mapSearchInputCompact,
              ]}
              placeholder="Search Locations"
              placeholderTextColor={
                resolvedScheme === 'dark' ? '#CBD5E1' : colors.textSecondary
              }
              value={mapSearch.searchText}
              onChangeText={mapSearch.setSearchText}
              onFocus={mapSearch.onSearchFocus}
              onBlur={mapSearch.onSearchBlur}
              returnKeyType="done"
              editable={!busy}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {mapSearch.showSearchSuggestions ? (
              <View style={[styles.suggestionsPanel, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <ScrollView
                  style={styles.suggestionsScroll}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                >
                  {mapSearch.savedLocationMatches.length > 0 ? (
                    <>
                      <Text style={styles.suggestionsSectionLabel}>In DriftGuide</Text>
                      {mapSearch.savedLocationMatches.map((loc) => (
                        <Pressable
                          key={`loc-${loc.id}`}
                          style={styles.suggestionRow}
                          onPress={() => {
                            const c = locationToNearbyCandidate(loc, latitude, longitude);
                            if (!c) return;
                            mapSearch.setSearchText(loc.name);
                            mapSearch.closeSuggestionsKeepText();
                            Keyboard.dismiss();
                            setHighlightCatalogPinId(c.id);
                            onPressCandidate(c);
                          }}
                          disabled={busy}
                        >
                          <Ionicons name="location-outline" size={16} color={colors.primary} />
                          <Text style={styles.suggestionTitle} numberOfLines={2}>
                            {loc.name}
                          </Text>
                        </Pressable>
                      ))}
                    </>
                  ) : null}
                  {mapSearch.mapSuggestionsLoading ? (
                    <View style={styles.suggestionsLoadingRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.suggestionsLoadingText}>Searching map near you…</Text>
                    </View>
                  ) : null}
                  {!mapSearch.mapSuggestionsLoading && mapSearch.mapSuggestions.length > 0 ? (
                    <>
                      <Text style={styles.suggestionsSectionLabel}>Map suggestions</Text>
                      {mapSearch.mapSuggestions.map((f) => (
                        <Pressable
                          key={f.id}
                          style={styles.suggestionRow}
                          onPress={() => {
                            if (!onPickMapGeocodeResult) return;
                            mapSearch.setSearchText(f.place_name);
                            mapSearch.closeSuggestionsKeepText();
                            Keyboard.dismiss();
                            onPickMapGeocodeResult(f);
                          }}
                          disabled={busy || !onPickMapGeocodeResult}
                        >
                          <Ionicons name="location-outline" size={16} color={colors.primary} />
                          <Text style={styles.suggestionTitle} numberOfLines={2}>
                            {f.place_name}
                          </Text>
                        </Pressable>
                      ))}
                    </>
                  ) : null}
                </ScrollView>
              </View>
            ) : null}
          </View>
        ) : null}
        {step === 1 ? (
          <>
            <Text style={styles.step1Title}>{step1Title}</Text>
            {step1Subtitle ? <Text style={styles.step1Subtitle}>{step1Subtitle}</Text> : null}
            {candidates.length === 0 && step1EmptyHint ? (
              <Text style={styles.step1EmptyHint}>{step1EmptyHint}</Text>
            ) : null}
            {candidates.length > 0
              ? candidates.map((c) => {
                  const rowKm = haversineDistance(latitude, longitude, c.latitude, c.longitude);
                  return (
                    <Pressable
                      key={c.id}
                      style={[styles.parentRow, { backgroundColor: listRowBg }]}
                      onPress={() => {
                        setHighlightCatalogPinId(c.id);
                        onPressCandidate(c);
                      }}
                      disabled={rowDisabled}
                    >
                      <View style={styles.parentRowText}>
                        <Text style={styles.parentRowName} numberOfLines={2}>
                          {c.name}
                        </Text>
                        <Text style={styles.parentRowMeta}>{formatProximityKm(rowKm)}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                    </Pressable>
                  );
                })
              : null}
            <Pressable
              style={[styles.declineBtn, { backgroundColor: listRowBg }]}
              onPress={onPressNotPartOfList}
              disabled={busy}
            >
              <Text style={styles.declineBtnText}>{notPartOfListLabel}</Text>
            </Pressable>
          </>
        ) : (
          <>
            {onPressStep2Back ? (
              <Pressable
                style={styles.step2BackRow}
                onPress={onPressStep2Back}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Ionicons name="chevron-back" size={20} color={colors.primary} />
                <Text style={styles.step2BackText}>Back</Text>
              </Pressable>
            ) : null}
            {showSpotDetailFields ? (
              <>
                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  style={styles.nameInput}
                  placeholder="e.g. Riverside access"
                  placeholderTextColor={colors.textTertiary}
                  value={name}
                  onChangeText={onNameChange}
                  returnKeyType="done"
                  editable={!busy}
                />
                <Text style={[styles.fieldLabel, { marginTop: Spacing.md }]}>Type</Text>
                <Pressable style={styles.typeDropdown} onPress={onPressOpenTypePicker} disabled={busy}>
                  <Text style={[styles.typeDropdownText, locationType == null && styles.typeDropdownPlaceholder]}>
                    {typeLabel(locationType)}
                  </Text>
                  <Text style={styles.typeChevron}>▾</Text>
                </Pressable>
                <View style={styles.publicRow}>
                  <Text style={styles.publicLabel}>Public location</Text>
                  <Switch
                    value={isPublic}
                    onValueChange={onIsPublicChange}
                    disabled={busy}
                    trackColor={{ false: colors.border, true: colors.primary + '99' }}
                    thumbColor={Platform.OS === 'android' ? (isPublic ? colors.primary : colors.textTertiary) : undefined}
                    ios_backgroundColor={colors.border}
                  />
                </View>
              </>
            ) : null}
            {primaryInScroll ? primaryButtonEl : null}
          </>
        )}
      </ScrollView>
      {primaryInFooter ? (
        <View style={[styles.primaryFooter, { paddingHorizontal: Spacing.lg }]}>{primaryButtonEl}</View>
      ) : null}
    </View>
  );
}

function formatProximityKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}

function createStyles(colors: ThemeColors, scheme: ResolvedScheme) {
  const glass = {
    idle:
      scheme === 'dark'
        ? { bg: 'rgba(30, 41, 59, 0.72)', border: 'rgba(51, 65, 85, 0.85)' }
        : { bg: 'rgba(255, 255, 255, 0.42)', border: 'rgba(226, 232, 240, 0.65)' },
    editing:
      scheme === 'dark'
        ? { bg: 'rgba(30, 41, 59, 0.88)', border: 'rgba(71, 85, 105, 0.95)' }
        : { bg: 'rgba(255, 255, 255, 0.58)', border: 'rgba(226, 232, 240, 0.85)' },
    filled:
      scheme === 'dark'
        ? { bg: 'rgba(51, 65, 85, 0.92)', border: 'rgba(100, 116, 139, 0.95)' }
        : { bg: 'rgba(255, 255, 255, 0.8)', border: 'rgba(226, 232, 240, 0.95)' },
  };
  return StyleSheet.create({
    column: {
      flex: 1,
      minHeight: 0,
    },
    mapSection: {
      minHeight: 0,
    },
    mapWrap: {
      flex: 1,
      minHeight: 140,
      overflow: 'hidden',
    },
    mapInner: {
      flex: 1,
      marginBottom: 0,
    },
    panelScroll: {
      minHeight: 0,
    },
    panelContent: {
      paddingTop: Spacing.md,
    },
    mapSearchBlock: {
      alignSelf: 'stretch',
      marginBottom: Spacing.md,
      zIndex: 4,
    },
    mapSearchInput: {
      width: '100%',
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
      borderWidth: 1,
    },
    mapSearchInputIdle: {
      backgroundColor: glass.idle.bg,
      borderColor: glass.idle.border,
    },
    mapSearchInputEditing: {
      backgroundColor: glass.editing.bg,
      borderColor: glass.editing.border,
    },
    mapSearchInputFilled: {
      backgroundColor: glass.filled.bg,
      borderColor: glass.filled.border,
    },
    mapSearchInputCompact: {
      paddingVertical: 5,
      paddingHorizontal: 12,
      fontSize: FontSize.sm,
      borderRadius: BorderRadius.sm,
    },
    suggestionsPanel: {
      marginTop: Spacing.xs,
      maxHeight: 187,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
    suggestionsScroll: {
      maxHeight: 187,
    },
    suggestionsSectionLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: Spacing.sm,
      paddingTop: Spacing.xs,
      paddingBottom: 2,
    },
    suggestionsLoadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.sm,
    },
    suggestionsLoadingText: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
    },
    suggestionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: 6,
      paddingHorizontal: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderLight,
    },
    suggestionTitle: {
      flex: 1,
      fontSize: FontSize.sm,
      color: colors.text,
      fontWeight: '500',
      lineHeight: 18,
    },
    step1Title: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
      marginBottom: Spacing.sm,
    },
    step1Subtitle: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: Spacing.md,
    },
    step1EmptyHint: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: Spacing.md,
    },
    step2BackRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginBottom: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    step2BackText: {
      fontSize: FontSize.md,
      color: colors.primary,
      fontWeight: '600',
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
    primaryFooter: {
      flexShrink: 0,
      paddingTop: Spacing.md,
    },
    primaryBtn: {
      marginTop: Spacing.xl,
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
      alignItems: 'center',
    },
    primaryBtnFooter: {
      marginTop: 0,
    },
    primaryBtnDisabled: {
      opacity: 0.7,
    },
    primaryBtnText: {
      color: colors.textInverse,
      fontSize: FontSize.md,
      fontWeight: '700',
    },
  });
}
