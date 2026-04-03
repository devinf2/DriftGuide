import { useMemo } from 'react';
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
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { CatchPinPickerMap } from '@/src/components/map/CatchPinPickerMap';
import { haversineDistance } from '@/src/services/locationService';
import type { LocationType, NearbyLocationResult } from '@/src/types';

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
};

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
}: LocationPinParentTwoStepFlowProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const busy = primaryBusy || interactionDisabled;
  const rowDisabled = busy || step1CandidatesDisabled;
  const columnStyle = edgeToEdgeMap ? [styles.column, { marginHorizontal: -Spacing.lg }] : styles.column;
  const mapSectionStyle =
    mapFixedHeight != null
      ? [styles.mapSection, { height: mapFixedHeight, flex: 0 }]
      : [styles.mapSection, { flex: mapFlex }];
  const listRowBg = step1ListSurface === 'canvas' ? colors.background : colors.surface;

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
                      onPress={() => onPressCandidate(c)}
                      disabled={rowDisabled}
                    >
                      <View style={styles.parentRowText}>
                        <Text style={styles.parentRowName} numberOfLines={2}>
                          Part of {c.name}
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
            <Pressable
              style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
              onPress={onPressPrimary}
              disabled={busy}
            >
              {primaryBusy ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.primaryBtnText}>{primaryButtonLabel}</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function formatProximityKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}

function createStyles(colors: ThemeColors) {
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
  });
}
