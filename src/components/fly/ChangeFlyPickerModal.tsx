import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FLY_COLORS, FLY_NAMES, FLY_SIZES } from '@/src/constants/fishingTypes';
import { BorderRadius, Colors, FontSize, Spacing } from '@/src/constants/theme';
import type { Fly, FlyChangeData, NextFlyRecommendation } from '@/src/types';

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
          pattern: rec.pattern2,
          size: rec.size2 ?? null,
          color: rec.color2 ?? null,
          fly_id: rec.fly_id2 ?? undefined,
          fly_color_id: rec.fly_color_id2 ?? undefined,
          fly_size_id: rec.fly_size_id2 ?? undefined,
        }
      : null;
  return { primary, dropper };
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
  flyPickerNames: string[];
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
  flyPickerNames,
  seedKey,
  initialPrimary,
  initialDropper,
  title = 'Select Fly',
  onConfirm,
  nextFlyRecommendation = null,
  recommendationLoading = false,
}: ChangeFlyPickerModalProps) {
  const [pickerName, setPickerName] = useState<string | null>(null);
  const [pickerSize, setPickerSize] = useState<number | null>(null);
  const [pickerColor, setPickerColor] = useState<string | null>(null);
  const [pickerName2, setPickerName2] = useState<string | null>(null);
  const [pickerSize2, setPickerSize2] = useState<number | null>(null);
  const [pickerColor2, setPickerColor2] = useState<string | null>(null);
  const [flyNameSearch, setFlyNameSearch] = useState('');

  useEffect(() => {
    if (!visible) return;
    const p = initialPrimary;
    setPickerName(p?.pattern ?? null);
    setPickerSize(p?.size ?? null);
    setPickerColor(p?.color ?? null);
    const d = initialDropper;
    if (d?.pattern != null && String(d.pattern).trim()) {
      setPickerName2(d.pattern);
      setPickerSize2(d.size ?? null);
      setPickerColor2(d.color ?? null);
    } else {
      setPickerName2(null);
      setPickerSize2(null);
      setPickerColor2(null);
    }
    setFlyNameSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed on open / seedKey; avoid resetting when parent passes new object refs
  }, [visible, seedKey]);

  const flyNamesWithOther = useMemo(() => {
    const hasOther = flyPickerNames.some((n) => n === 'Other');
    return hasOther ? flyPickerNames : [...flyPickerNames, 'Other'];
  }, [flyPickerNames]);

  const filteredFlyNames = useMemo(() => {
    const q = flyNameSearch.trim().toLowerCase();
    if (!q) return flyNamesWithOther;
    const filtered = flyNamesWithOther.filter((n) => n.toLowerCase().includes(q));
    return filtered.includes('Other') ? filtered : [...filtered, 'Other'];
  }, [flyNamesWithOther, flyNameSearch]);

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
      fly_id: matchPrimary?.fly_id ?? undefined,
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
              fly_id: match2?.fly_id ?? undefined,
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
    pickerName2,
    pickerSize2,
    pickerColor2,
    userFlies,
    onConfirm,
  ]);

  const applyNextRecommendation = useCallback(() => {
    if (!nextFlyRecommendation) return;
    const { primary, dropper } = selectionFromNextRecommendation(nextFlyRecommendation);
    onConfirm(primary, dropper);
  }, [nextFlyRecommendation, onConfirm]);

  const confirmLabel = pickerName
    ? pickerName2
      ? `Select ${pickerName}${pickerSize ? ` #${pickerSize}` : ''} / ${pickerName2}${pickerSize2 ? ` #${pickerSize2}` : ''}`
      : `Select ${pickerName}${pickerSize ? ` #${pickerSize}` : ''}${pickerColor ? ` · ${pickerColor}` : ''}`
    : 'Choose a fly name';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <SafeAreaView style={styles.flyPickerModalContainer} edges={['top', 'left', 'right', 'bottom']}>
        <Pressable style={styles.flyPickerBackdrop} onPress={onClose} />
        <View style={[styles.flyPickerSheet, styles.flyPickerSheetSized]}>
          <View style={styles.flyPickerHeader}>
            <Text style={styles.flyPickerTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.flyPickerClose}>Cancel</Text>
            </Pressable>
          </View>
          {nextFlyRecommendation ? (
            <Pressable style={styles.nextFlyBanner} onPress={applyNextRecommendation}>
              <View style={styles.nextFlyLeft}>
                <Text style={styles.nextFlyLabel}>
                  {recommendationLoading ? 'AI thinking\u2026' : 'Try next'}
                </Text>
                <Text style={styles.nextFlyName}>
                  {nextFlyRecommendation.pattern2
                    ? `${nextFlyRecommendation.pattern} #${nextFlyRecommendation.size} / ${nextFlyRecommendation.pattern2} #${nextFlyRecommendation.size2 ?? ''}`
                    : `${nextFlyRecommendation.pattern} #${nextFlyRecommendation.size}`}
                </Text>
                {nextFlyRecommendation.reason ? (
                  <Text style={styles.nextFlyReason} numberOfLines={2}>
                    {nextFlyRecommendation.reason}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.nextFlyTap}>Tap to switch</Text>
            </Pressable>
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
                  <Text style={styles.flyFieldLabel}>Thumbnail</Text>
                  <View style={styles.flyThumbnailRow}>
                    {primaryUrl ? <Image source={{ uri: primaryUrl }} style={styles.flyThumbnailImage} /> : null}
                    {dropperUrl ? <Image source={{ uri: dropperUrl }} style={styles.flyThumbnailImage} /> : null}
                  </View>
                </>
              );
            })()}

            <Text style={styles.flyFieldLabel}>
              Name{flyPickerNames !== FLY_NAMES ? ' (from Fly Box)' : ''}
            </Text>
            <TextInput
              style={styles.flyNameSearchInput}
              placeholder="Search fly name..."
              placeholderTextColor={Colors.textTertiary}
              value={flyNameSearch}
              onChangeText={setFlyNameSearch}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <View style={styles.chipRow}>
                {filteredFlyNames.map((name) => (
                  <Pressable
                    key={name}
                    style={[styles.chip, pickerName === name && styles.chipActive]}
                    onPress={() => setPickerName(name)}
                  >
                    <Text style={[styles.chipText, pickerName === name && styles.chipTextActive]}>{name}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.flyFieldLabel}>Size</Text>
            <View style={styles.chipRow}>
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

            <Text style={styles.flyFieldLabel}>Color</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <View style={styles.chipRow}>
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
                  }}
                >
                  <Text style={styles.addDropperButtonText}>Remove dropper</Text>
                </Pressable>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  <View style={styles.chipRow}>
                    {filteredFlyNames.map((name) => (
                      <Pressable
                        key={name}
                        style={[styles.chip, pickerName2 === name && styles.chipActive]}
                        onPress={() => setPickerName2(name)}
                      >
                        <Text style={[styles.chipText, pickerName2 === name && styles.chipTextActive]}>{name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                <View style={styles.chipRow}>
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
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  <View style={styles.chipRow}>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  flyPickerModalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  flyPickerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  flyPickerSheet: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  flyPickerSheetSized: {
    maxHeight: Dimensions.get('window').height * 0.82,
    height: Dimensions.get('window').height * 0.82,
  },
  flyPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  nextFlyBanner: {
    backgroundColor: Colors.accent,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  nextFlyLeft: {
    flex: 1,
  },
  nextFlyLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textInverse,
    textTransform: 'uppercase',
  },
  nextFlyName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textInverse,
  },
  nextFlyReason: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  nextFlyTap: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.7)',
  },
  flyPickerTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  flyPickerClose: {
    fontSize: FontSize.md,
    color: Colors.primary,
    fontWeight: '600',
  },
  flyPickerScroll: {
    flex: 1,
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
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
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
    backgroundColor: Colors.border,
  },
  flyFieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  flyNameSearchInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    marginBottom: Spacing.sm,
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
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  chipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '15',
  },
  chipText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: Colors.primary,
    fontWeight: '600',
  },
  addDropperButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    alignSelf: 'flex-start',
  },
  addDropperButtonText: {
    fontSize: FontSize.sm,
    color: Colors.primary,
  },
  confirmFlyButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  confirmFlyButtonDisabled: {
    backgroundColor: Colors.border,
  },
  confirmFlyButtonText: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
});
