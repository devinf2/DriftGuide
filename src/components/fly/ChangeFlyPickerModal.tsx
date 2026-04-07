import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FLY_COLORS, FLY_SIZES } from '@/src/constants/fishingTypes';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { Fly, FlyCatalog, FlyChangeData, NextFlyRecommendation } from '@/src/types';
import { mergeTryNextWithSyntheticDropperIfMissing } from '@/src/services/ai';
import { TripFlyPatternPickerModal } from '@/src/components/fly/TripFlyPatternPickerModal';

function selectionFromNextRecommendation(rec: NextFlyRecommendation): {
  primary: FlyChangeData;
  dropper: FlyChangeData | null;
} {
  const primary: FlyChangeData = {
    pattern: rec.pattern,
    size: rec.size,
    color: rec.color,
    fly_id: rec.fly_id ?? undefined,
    fly_color_id: rec.fly_color_id ?? undefined,
    fly_size_id: rec.fly_size_id ?? undefined,
  };
  const dropper =
    rec.pattern2 != null && rec.pattern2.trim()
      ? {
          pattern: rec.pattern2.trim(),
          size: rec.size2 ?? null,
          color: rec.color2 ?? null,
          fly_id: rec.fly_id2 ?? undefined,
          fly_color_id: rec.fly_color_id2 ?? undefined,
          fly_size_id: rec.fly_size_id2 ?? undefined,
        }
      : null;
  return { primary, dropper };
}

export function primaryFromRecommendation(rec: NextFlyRecommendation): FlyChangeData {
  return {
    pattern: rec.pattern,
    size: rec.size,
    color: rec.color,
    fly_id: rec.fly_id ?? undefined,
    fly_color_id: rec.fly_color_id ?? undefined,
    fly_size_id: rec.fly_size_id ?? undefined,
  };
}

export function dropperFromRecommendation(rec: NextFlyRecommendation): FlyChangeData | null {
  if (!rec.pattern2?.trim()) return null;
  return {
    pattern: rec.pattern2.trim(),
    size: rec.size2 ?? null,
    color: rec.color2 ?? null,
    fly_id: rec.fly_id2 ?? undefined,
    fly_color_id: rec.fly_color_id2 ?? undefined,
    fly_size_id: rec.fly_size_id2 ?? undefined,
  };
}

export function seedSelectionFromFlyChange(
  p: FlyChangeData | null | undefined,
  userFlies: Fly[],
  catalog: FlyCatalog[],
): { userBoxId: string | null; catalogFlyId: string | null; manual: boolean } {
  if (!p?.pattern?.trim()) {
    return { userBoxId: null, catalogFlyId: null, manual: false };
  }
  const pat = p.pattern.trim();
  const um = userFlies.find(
    (f) =>
      f.name === pat &&
      (f.size ?? null) === (p.size ?? null) &&
      (f.color ?? null) === (p.color ?? null),
  );
  if (um) return { userBoxId: um.id, catalogFlyId: null, manual: false };
  if (p.fly_id && catalog.some((c) => c.id === p.fly_id)) {
    return { userBoxId: null, catalogFlyId: p.fly_id, manual: false };
  }
  const byName = catalog.find((c) => c.name === pat);
  if (byName) return { userBoxId: null, catalogFlyId: byName.id, manual: false };
  return { userBoxId: null, catalogFlyId: null, manual: true };
}

function applyFlyChangeToState(
  p: FlyChangeData,
  userFlies: Fly[],
  catalog: FlyCatalog[],
): {
  pattern: string;
  size: number | null;
  color: string | null;
  userBoxId: string | null;
  catalogFlyId: string | null;
  manual: boolean;
} {
  const seed = seedSelectionFromFlyChange(p, userFlies, catalog);
  return {
    pattern: p.pattern.trim(),
    size: p.size ?? null,
    color: p.color ?? null,
    userBoxId: seed.userBoxId,
    catalogFlyId: seed.catalogFlyId,
    manual: seed.manual,
  };
}

/** Split stored fly_change `data` into primary + optional dropper for the picker. */
export function splitFlyChangeData(data: FlyChangeData): {
  primary: FlyChangeData;
  dropper: FlyChangeData | null;
} {
  const primary: FlyChangeData = {
    pattern: data.pattern,
    size: data.size,
    color: data.color,
    fly_id: data.fly_id,
    fly_color_id: data.fly_color_id,
    fly_size_id: data.fly_size_id,
  };
  const has2 = data.pattern2 != null && String(data.pattern2).trim().length > 0;
  if (!has2) return { primary, dropper: null };
  return {
    primary,
    dropper: {
      pattern: data.pattern2!,
      size: data.size2 ?? null,
      color: data.color2 ?? null,
      fly_id: data.fly_id2 ?? undefined,
      fly_color_id: data.fly_color_id2 ?? undefined,
      fly_size_id: data.fly_size_id2 ?? undefined,
    },
  };
}

/** Merge picker primary + dropper into one `FlyChangeData` for events / store. */
export function mergeFlyPickerSelection(primary: FlyChangeData, dropper: FlyChangeData | null): FlyChangeData {
  return {
    pattern: primary.pattern,
    size: primary.size,
    color: primary.color,
    fly_id: primary.fly_id,
    fly_color_id: primary.fly_color_id,
    fly_size_id: primary.fly_size_id,
    ...(dropper
      ? {
          pattern2: dropper.pattern,
          size2: dropper.size ?? null,
          color2: dropper.color ?? null,
          fly_id2: dropper.fly_id ?? null,
          fly_color_id2: dropper.fly_color_id ?? null,
          fly_size_id2: dropper.fly_size_id ?? null,
        }
      : {}),
  };
}

export type ChangeFlyPickerModalProps = {
  visible: boolean;
  onClose: () => void;
  userFlies: Fly[];
  /** Global catalog for “All flies” section */
  flyCatalog: FlyCatalog[];
  /** Re-seed internal pickers when this changes (e.g. event id or `'rig'`). */
  seedKey: string;
  initialPrimary: FlyChangeData | null;
  initialDropper: FlyChangeData | null;
  title?: string;
  onConfirm: (primary: FlyChangeData, dropper: FlyChangeData | null) => void;
  /** When set (e.g. active trip, not editing a timeline row), shows Try next banner above the form. */
  nextFlyRecommendation?: NextFlyRecommendation | null;
  recommendationLoading?: boolean;
};

export function ChangeFlyPickerModal({
  visible,
  onClose,
  userFlies,
  flyCatalog,
  seedKey,
  initialPrimary,
  initialDropper,
  title = 'Select Fly',
  onConfirm,
  nextFlyRecommendation = null,
  recommendationLoading = false,
}: ChangeFlyPickerModalProps) {
  const { colors, resolvedScheme } = useAppTheme();
  const scrim =
    resolvedScheme === 'dark' ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.52)';
  const styles = useMemo(() => createFlyPickerStyles(colors, scrim), [colors, scrim]);

  const [pickerName, setPickerName] = useState<string | null>(null);
  const [pickerSize, setPickerSize] = useState<number | null>(null);
  const [pickerColor, setPickerColor] = useState<string | null>(null);
  const [primaryUserBoxFlyId, setPrimaryUserBoxFlyId] = useState<string | null>(null);
  const [primaryCatalogFlyId, setPrimaryCatalogFlyId] = useState<string | null>(null);
  const [primaryManual, setPrimaryManual] = useState(false);

  const [pickerName2, setPickerName2] = useState<string | null>(null);
  const [pickerSize2, setPickerSize2] = useState<number | null>(null);
  const [pickerColor2, setPickerColor2] = useState<string | null>(null);
  const [dropperUserBoxFlyId, setDropperUserBoxFlyId] = useState<string | null>(null);
  const [dropperCatalogFlyId, setDropperCatalogFlyId] = useState<string | null>(null);
  const [dropperManual, setDropperManual] = useState(false);

  const [primaryPatternPickerOpen, setPrimaryPatternPickerOpen] = useState(false);
  const [dropperPatternPickerOpen, setDropperPatternPickerOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const p = initialPrimary;
    setPickerName(p?.pattern?.trim() ? p.pattern.trim() : null);
    setPickerSize(p?.size ?? null);
    setPickerColor(p?.color ?? null);
    const ps = seedSelectionFromFlyChange(p, userFlies, flyCatalog);
    setPrimaryUserBoxFlyId(ps.userBoxId);
    setPrimaryCatalogFlyId(ps.catalogFlyId);
    setPrimaryManual(ps.manual);

    const d = initialDropper;
    if (d?.pattern != null && String(d.pattern).trim()) {
      setPickerName2(d.pattern.trim());
      setPickerSize2(d.size ?? null);
      setPickerColor2(d.color ?? null);
      const ds = seedSelectionFromFlyChange(d, userFlies, flyCatalog);
      setDropperUserBoxFlyId(ds.userBoxId);
      setDropperCatalogFlyId(ds.catalogFlyId);
      setDropperManual(ds.manual);
    } else {
      setPickerName2(null);
      setPickerSize2(null);
      setPickerColor2(null);
      setDropperUserBoxFlyId(null);
      setDropperCatalogFlyId(null);
      setDropperManual(false);
    }
    setPrimaryPatternPickerOpen(false);
    setDropperPatternPickerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed on open / seedKey / catalog lists / initial rows
  }, [
    visible,
    seedKey,
    userFlies,
    flyCatalog,
    initialPrimary?.pattern,
    initialPrimary?.size,
    initialPrimary?.color,
    initialPrimary?.fly_id,
    initialDropper?.pattern,
    initialDropper?.size,
    initialDropper?.color,
    initialDropper?.fly_id,
  ]);

  const handleConfirm = useCallback(() => {
    if (!pickerName?.trim()) return;
    const matchPrimary = userFlies.find(
      (f) =>
        f.name === pickerName.trim() &&
        (f.size ?? null) === (pickerSize ?? null) &&
        (f.color ?? null) === (pickerColor ?? null),
    );
    const primary: FlyChangeData = {
      pattern: pickerName.trim(),
      size: pickerSize ?? null,
      color: pickerColor ?? null,
      fly_id: matchPrimary?.fly_id ?? primaryCatalogFlyId ?? undefined,
      fly_color_id: matchPrimary?.fly_color_id ?? undefined,
      fly_size_id: matchPrimary?.fly_size_id ?? undefined,
    };
    const dropper =
      pickerName2 != null && String(pickerName2).trim()
        ? (() => {
            const match2 = userFlies.find(
              (f) =>
                f.name === pickerName2.trim() &&
                (f.size ?? null) === (pickerSize2 ?? null) &&
                (f.color ?? null) === (pickerColor2 ?? null),
            );
            const d: FlyChangeData = {
              pattern: pickerName2.trim(),
              size: pickerSize2 ?? null,
              color: pickerColor2 ?? null,
              fly_id: match2?.fly_id ?? dropperCatalogFlyId ?? undefined,
              fly_color_id: match2?.fly_color_id ?? undefined,
              fly_size_id: match2?.fly_size_id ?? undefined,
            };
            return d;
          })()
        : null;
    onConfirm(primary, dropper);
  }, [
    pickerName,
    pickerSize,
    pickerColor,
    primaryCatalogFlyId,
    pickerName2,
    pickerSize2,
    pickerColor2,
    dropperCatalogFlyId,
    userFlies,
    onConfirm,
  ]);

  /** Dropper row visible (Add dropper tapped, or initial rig had a dropper). */
  const dropperSectionOpen = pickerName2 !== null;

  const effectiveNextFlyRecommendation = useMemo(() => {
    if (!nextFlyRecommendation) return null;
    if (!dropperSectionOpen) return nextFlyRecommendation;
    return mergeTryNextWithSyntheticDropperIfMissing(nextFlyRecommendation, userFlies);
  }, [nextFlyRecommendation, dropperSectionOpen, userFlies]);

  const hasSecondaryRec =
    effectiveNextFlyRecommendation != null &&
    Boolean(effectiveNextFlyRecommendation.pattern2?.trim());

  const applyNextRecommendation = useCallback(() => {
    if (!effectiveNextFlyRecommendation) return;
    const { primary, dropper } = selectionFromNextRecommendation(effectiveNextFlyRecommendation);
    onConfirm(primary, dropper);
  }, [effectiveNextFlyRecommendation, onConfirm]);

  const applyPrimarySuggestion = useCallback(() => {
    if (!effectiveNextFlyRecommendation) return;
    const slice = primaryFromRecommendation(effectiveNextFlyRecommendation);
    const st = applyFlyChangeToState(slice, userFlies, flyCatalog);
    setPickerName(st.pattern);
    setPickerSize(st.size);
    setPickerColor(st.color);
    setPrimaryUserBoxFlyId(st.userBoxId);
    setPrimaryCatalogFlyId(st.catalogFlyId);
    setPrimaryManual(st.manual);
  }, [effectiveNextFlyRecommendation, userFlies, flyCatalog]);

  const applyDropperSuggestion = useCallback(() => {
    if (!effectiveNextFlyRecommendation) return;
    const slice = dropperFromRecommendation(effectiveNextFlyRecommendation);
    if (!slice) return;
    const st = applyFlyChangeToState(slice, userFlies, flyCatalog);
    setPickerName2(st.pattern);
    setPickerSize2(st.size);
    setPickerColor2(st.color);
    setDropperUserBoxFlyId(st.userBoxId);
    setDropperCatalogFlyId(st.catalogFlyId);
    setDropperManual(st.manual);
  }, [effectiveNextFlyRecommendation, userFlies, flyCatalog]);

  const confirmLabel = pickerName
    ? pickerName2
      ? `Select ${pickerName}${pickerSize ? ` #${pickerSize}` : ''} / ${pickerName2}${pickerSize2 ? ` #${pickerSize2}` : ''}`
      : `Select ${pickerName}${pickerSize ? ` #${pickerSize}` : ''}${pickerColor ? ` · ${pickerColor}` : ''}`
    : 'Choose a fly name';

  const primaryPatternSummary = useMemo(() => {
    if (!pickerName?.trim()) return null;
    const bits = [pickerName.trim()];
    if (pickerSize != null) bits.push(`#${pickerSize}`);
    if (pickerColor?.trim()) bits.push(pickerColor.trim());
    return bits.join(' · ');
  }, [pickerName, pickerSize, pickerColor]);

  const dropperPatternSummary = useMemo(() => {
    if (!pickerName2?.trim()) return null;
    const bits = [pickerName2.trim()];
    if (pickerSize2 != null) bits.push(`#${pickerSize2}`);
    if (pickerColor2?.trim()) bits.push(pickerColor2.trim());
    return bits.join(' · ');
  }, [pickerName2, pickerSize2, pickerColor2]);

  const windowH = Dimensions.get('window').height;
  const sheetMaxH = windowH * 0.92;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : 'fullScreen'}
      statusBarTranslucent={Platform.OS === 'android'}
      transparent={Platform.OS === 'android'}
    >
      <View style={styles.modalRoot} pointerEvents="box-none">
        <Pressable
          style={styles.modalDimTap}
          onPress={onClose}
          accessibilityLabel="Close"
          accessibilityRole="button"
        />
        <View style={styles.modalSheetOverlay} pointerEvents="box-none">
          <SafeAreaView edges={['bottom']} style={styles.modalSheetSafe}>
            <View style={[styles.flyPickerSheet, { height: sheetMaxH }]}>
          <View style={styles.flyPickerHeader}>
            <Text style={styles.flyPickerTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.flyPickerClose}>Cancel</Text>
            </Pressable>
          </View>
          {effectiveNextFlyRecommendation ? (
            <View style={styles.nextFlyBanner}>
              <View style={styles.nextFlyLeft}>
                <Text style={styles.nextFlyLabel}>
                  {recommendationLoading ? 'AI thinking\u2026' : 'Try next'}
                </Text>
                {effectiveNextFlyRecommendation.reason ? (
                  <Text style={styles.nextFlyReason} numberOfLines={5}>
                    {effectiveNextFlyRecommendation.reason}
                  </Text>
                ) : null}
                {hasSecondaryRec ? (
                  <>
                    <Pressable style={styles.nextFlyAction} onPress={applyPrimarySuggestion}>
                      <Text style={styles.nextFlyActionLabel}>Primary</Text>
                      <Text style={styles.nextFlyActionValue}>
                        {effectiveNextFlyRecommendation.pattern}
                        {effectiveNextFlyRecommendation.size != null ? ` #${effectiveNextFlyRecommendation.size}` : ''}
                        {effectiveNextFlyRecommendation.color ? ` · ${effectiveNextFlyRecommendation.color}` : ''}
                      </Text>
                    </Pressable>
                    <Pressable style={styles.nextFlyAction} onPress={applyDropperSuggestion}>
                      <Text style={styles.nextFlyActionLabel}>Dropper</Text>
                      <Text style={styles.nextFlyActionValue}>
                        {effectiveNextFlyRecommendation.pattern2}
                        {effectiveNextFlyRecommendation.size2 != null ? ` #${effectiveNextFlyRecommendation.size2}` : ''}
                        {effectiveNextFlyRecommendation.color2 ? ` · ${effectiveNextFlyRecommendation.color2}` : ''}
                      </Text>
                    </Pressable>
                    <Pressable style={styles.nextFlyFullRig} onPress={applyNextRecommendation}>
                      <Text style={styles.nextFlyFullRigText}>Apply full rig</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable style={styles.nextFlyAction} onPress={applyPrimarySuggestion}>
                    <Text style={styles.nextFlyActionLabel}>Suggestion</Text>
                    <Text style={styles.nextFlyActionValue}>
                      {effectiveNextFlyRecommendation.pattern}
                      {effectiveNextFlyRecommendation.size != null ? ` #${effectiveNextFlyRecommendation.size}` : ''}
                      {effectiveNextFlyRecommendation.color ? ` · ${effectiveNextFlyRecommendation.color}` : ''}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          ) : null}
          <ScrollView
            style={styles.flyPickerScroll}
            contentContainerStyle={styles.flyPickerContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {(pickerName || pickerName2) && (() => {
              const matchPrimary = userFlies.find(
                (f) =>
                  f.name === (pickerName ?? '')?.trim() &&
                  (f.size ?? null) === (pickerSize ?? null) &&
                  (f.color ?? null) === (pickerColor ?? null),
              );
              const matchDropper =
                pickerName2 != null && String(pickerName2).trim()
                  ? userFlies.find(
                      (f) =>
                        f.name === String(pickerName2).trim() &&
                        (f.size ?? null) === (pickerSize2 ?? null) &&
                        (f.color ?? null) === (pickerColor2 ?? null),
                    )
                  : null;
              const primaryUrl = matchPrimary?.photo_url ?? null;
              const dropperUrl = matchDropper?.photo_url ?? null;
              if (!primaryUrl && !dropperUrl) return null;
              return (
                <>
                  <Text style={styles.flyFieldLabel}>Photo (optional)</Text>
                  <View style={styles.flyThumbnailRow}>
                    {primaryUrl ? <Image source={{ uri: primaryUrl }} style={styles.flyThumbnailImage} /> : null}
                    {dropperUrl ? <Image source={{ uri: dropperUrl }} style={styles.flyThumbnailImage} /> : null}
                  </View>
                </>
              );
            })()}

            <Text style={styles.flyFieldLabel}>Pattern</Text>
            <Pressable style={styles.patternTrigger} onPress={() => setPrimaryPatternPickerOpen(true)}>
              <Text
                style={[styles.patternTriggerText, !primaryPatternSummary && styles.patternTriggerPlaceholder]}
                numberOfLines={2}
              >
                {primaryPatternSummary ?? 'Select pattern'}
              </Text>
              <Ionicons name="chevron-down" size={22} color={colors.textSecondary} />
            </Pressable>
            {primaryManual ? (
              <TextInput
                style={styles.manualPatternInput}
                value={pickerName ?? ''}
                onChangeText={(t) => {
                  setPickerName(t.length > 0 ? t : null);
                  setPrimaryUserBoxFlyId(null);
                  setPrimaryCatalogFlyId(null);
                }}
                placeholder="Custom pattern name"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="words"
              />
            ) : null}

            <Text style={styles.flyFieldLabel}>Size (optional)</Text>
            <View style={styles.chipRow}>
              <Pressable
                style={[styles.chip, pickerSize === null && styles.chipActive]}
                onPress={() => setPickerSize(null)}
              >
                <Text style={[styles.chipText, pickerSize === null && styles.chipTextActive]}>None</Text>
              </Pressable>
              {FLY_SIZES.map((size) => (
                <Pressable
                  key={size}
                  style={[styles.chip, pickerSize === size && styles.chipActive]}
                  onPress={() => setPickerSize(size)}
                >
                  <Text style={[styles.chipText, pickerSize === size && styles.chipTextActive]}>#{size}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.flyFieldLabel}>Color (optional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <View style={styles.chipRow}>
                <Pressable
                  style={[styles.chip, pickerColor === null && styles.chipActive]}
                  onPress={() => setPickerColor(null)}
                >
                  <Text style={[styles.chipText, pickerColor === null && styles.chipTextActive]}>None</Text>
                </Pressable>
                {FLY_COLORS.map((color) => (
                  <Pressable
                    key={color}
                    style={[styles.chip, pickerColor === color && styles.chipActive]}
                    onPress={() => setPickerColor(color)}
                  >
                    <Text style={[styles.chipText, pickerColor === color && styles.chipTextActive]}>{color}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text style={[styles.flyFieldLabel, { marginTop: Spacing.md }]}>Second fly (dropper)</Text>
            {pickerName2 === null ? (
              <Pressable style={styles.addDropperButton} onPress={() => setPickerName2('')}>
                <Text style={styles.addDropperButtonText}>Add dropper (e.g. hopper-dropper)</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  style={styles.addDropperButton}
                  onPress={() => {
                    setPickerName2(null);
                    setPickerSize2(null);
                    setPickerColor2(null);
                    setDropperUserBoxFlyId(null);
                    setDropperCatalogFlyId(null);
                    setDropperManual(false);
                  }}
                >
                  <Text style={styles.addDropperButtonText}>Remove dropper</Text>
                </Pressable>
                <Pressable style={styles.patternTrigger} onPress={() => setDropperPatternPickerOpen(true)}>
                  <Text
                    style={[styles.patternTriggerText, !dropperPatternSummary && styles.patternTriggerPlaceholder]}
                    numberOfLines={2}
                  >
                    {dropperPatternSummary ?? 'Select dropper pattern'}
                  </Text>
                  <Ionicons name="chevron-down" size={22} color={colors.textSecondary} />
                </Pressable>
                {dropperManual ? (
                  <TextInput
                    style={styles.manualPatternInput}
                    value={pickerName2 ?? ''}
                    onChangeText={(t) => {
                      setPickerName2(t.trim() ? t : '');
                      setDropperUserBoxFlyId(null);
                      setDropperCatalogFlyId(null);
                    }}
                    placeholder="Custom dropper name"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="words"
                  />
                ) : null}
                <Text style={styles.flyFieldLabel}>Size (optional)</Text>
                <View style={styles.chipRow}>
                  <Pressable
                    style={[styles.chip, pickerSize2 === null && styles.chipActive]}
                    onPress={() => setPickerSize2(null)}
                  >
                    <Text style={[styles.chipText, pickerSize2 === null && styles.chipTextActive]}>None</Text>
                  </Pressable>
                  {FLY_SIZES.map((size) => (
                    <Pressable
                      key={size}
                      style={[styles.chip, pickerSize2 === size && styles.chipActive]}
                      onPress={() => setPickerSize2(size)}
                    >
                      <Text style={[styles.chipText, pickerSize2 === size && styles.chipTextActive]}>#{size}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.flyFieldLabel}>Color (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  <View style={styles.chipRow}>
                    <Pressable
                      style={[styles.chip, pickerColor2 === null && styles.chipActive]}
                      onPress={() => setPickerColor2(null)}
                    >
                      <Text style={[styles.chipText, pickerColor2 === null && styles.chipTextActive]}>None</Text>
                    </Pressable>
                    {FLY_COLORS.map((color) => (
                      <Pressable
                        key={color}
                        style={[styles.chip, pickerColor2 === color && styles.chipActive]}
                        onPress={() => setPickerColor2(color)}
                      >
                        <Text style={[styles.chipText, pickerColor2 === color && styles.chipTextActive]}>{color}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}
          </ScrollView>

          <View style={styles.flyPickerFooter}>
            <Pressable
              style={[styles.confirmFlyButton, !pickerName && styles.confirmFlyButtonDisabled]}
              onPress={handleConfirm}
              disabled={!pickerName}
            >
              <Text style={styles.confirmFlyButtonText}>{confirmLabel}</Text>
            </Pressable>
          </View>
            </View>
          </SafeAreaView>
        </View>
      </View>

      <TripFlyPatternPickerModal
          visible={primaryPatternPickerOpen}
          onRequestClose={() => setPrimaryPatternPickerOpen(false)}
          userFlies={userFlies}
          catalog={flyCatalog}
          title="Primary pattern"
          selectedUserBoxFlyId={primaryUserBoxFlyId}
          selectedCatalogFlyId={primaryCatalogFlyId}
          otherActive={primaryManual}
          onSelectUserFly={(fly) => {
            setPickerName(fly.name);
            setPickerSize(fly.size ?? null);
            setPickerColor(fly.color ?? null);
            setPrimaryUserBoxFlyId(fly.id);
            setPrimaryCatalogFlyId(null);
            setPrimaryManual(false);
          }}
          onSelectCatalogFly={(item) => {
            setPickerName(item.name);
            setPickerSize(null);
            setPickerColor(null);
            setPrimaryUserBoxFlyId(null);
            setPrimaryCatalogFlyId(item.id);
            setPrimaryManual(false);
          }}
          initialOtherPatternName={pickerName ?? ''}
          onSelectOther={(customName) => {
            setPrimaryUserBoxFlyId(null);
            setPrimaryCatalogFlyId(null);
            setPrimaryManual(true);
            setPickerName(customName.trim() ? customName.trim() : null);
            setPickerSize(null);
            setPickerColor(null);
          }}
        />

        <TripFlyPatternPickerModal
          visible={dropperPatternPickerOpen}
          onRequestClose={() => setDropperPatternPickerOpen(false)}
          userFlies={userFlies}
          catalog={flyCatalog}
          title="Dropper pattern"
          selectedUserBoxFlyId={dropperUserBoxFlyId}
          selectedCatalogFlyId={dropperCatalogFlyId}
          otherActive={dropperManual}
          onSelectUserFly={(fly) => {
            setPickerName2(fly.name);
            setPickerSize2(fly.size ?? null);
            setPickerColor2(fly.color ?? null);
            setDropperUserBoxFlyId(fly.id);
            setDropperCatalogFlyId(null);
            setDropperManual(false);
          }}
          onSelectCatalogFly={(item) => {
            setPickerName2(item.name);
            setPickerSize2(null);
            setPickerColor2(null);
            setDropperUserBoxFlyId(null);
            setDropperCatalogFlyId(item.id);
            setDropperManual(false);
          }}
          initialOtherPatternName={pickerName2 ?? ''}
          onSelectOther={(customName) => {
            setDropperUserBoxFlyId(null);
            setDropperCatalogFlyId(null);
            setDropperManual(true);
            setPickerName2(customName.trim() ? customName.trim() : null);
            setPickerSize2(null);
            setPickerColor2(null);
          }}
        />
    </Modal>
  );
}

function createFlyPickerStyles(colors: ThemeColors, modalScrim: string) {
  return StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: modalScrim,
  },
  /** Full-screen tap target behind the sheet (sits under overlay in z-order). */
  modalDimTap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  modalSheetOverlay: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  modalSheetSafe: {
    width: '100%',
    backgroundColor: 'transparent',
  },
  flyPickerSheet: {
    width: '100%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    overflow: 'hidden',
    flexDirection: 'column',
    alignSelf: 'stretch',
  },
  flyPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  nextFlyBanner: {
    backgroundColor: colors.accent,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexShrink: 0,
    flexDirection: 'column',
  },
  nextFlyLeft: {
    width: '100%',
  },
  nextFlyLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: colors.textInverse,
    textTransform: 'uppercase',
  },
  nextFlyReason: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
    marginBottom: Spacing.sm,
  },
  nextFlyAction: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.xs,
  },
  nextFlyActionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.75)',
    textTransform: 'uppercase',
  },
  nextFlyActionValue: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.textInverse,
    marginTop: 2,
  },
  nextFlyFullRig: {
    marginTop: Spacing.sm,
    alignSelf: 'flex-start',
    paddingVertical: Spacing.xs,
  },
  nextFlyFullRigText: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: colors.textInverse,
    textDecorationLine: 'underline',
  },
  flyPickerTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  flyPickerClose: {
    fontSize: FontSize.md,
    color: colors.primary,
    fontWeight: '600',
  },
  flyPickerScroll: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
  },
  flyPickerContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  flyPickerFooter: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingBottom: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  flyThumbnailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  flyThumbnailImage: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.border,
  },
  flyFieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  patternTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    marginBottom: Spacing.sm,
    backgroundColor: colors.background,
    gap: Spacing.sm,
  },
  patternTriggerText: {
    flex: 1,
    fontSize: FontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  patternTriggerPlaceholder: {
    color: colors.textTertiary,
    fontWeight: '400',
  },
  manualPatternInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: colors.text,
    marginBottom: Spacing.md,
  },
  chipScroll: {
    marginBottom: Spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  chip: {
    backgroundColor: colors.background,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '15',
  },
  chipText: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  addDropperButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    alignSelf: 'flex-start',
  },
  addDropperButtonText: {
    fontSize: FontSize.sm,
    color: colors.primary,
  },
  confirmFlyButton: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  confirmFlyButtonDisabled: {
    backgroundColor: colors.border,
  },
  confirmFlyButtonText: {
    color: colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
});
}
