import { useMemo } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { hatchCategoryColor } from '@/src/components/hatchChart/hatchChartTheme';
import {
  HATCH_FLY_STAGE_LABELS,
  type DriftGuideHatchChartEntry,
  type HatchFly,
} from '@/src/data/driftGuideHatchChart';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';

type Props = {
  visible: boolean;
  fly: HatchFly | null;
  entry: DriftGuideHatchChartEntry | null;
  /** True when the user already has this pattern in their fly box. */
  inFlyBox: boolean;
  /** Hidden when there is no signed-in user to own a fly box. */
  canAddToFlyBox: boolean;
  onClose: () => void;
  onAddToFlyBox: () => void;
  onViewImage?: () => void;
};

/**
 * Detail sheet for a tapped "Matching flies" entry on the hatch chart. Turns the
 * previously dead-end fly tile (WS-E) into an actionable card: image, life stage,
 * the hatch it matches with that hatch's rig notes, whether it's already in the
 * user's fly box, and a one-tap add.
 */
export function HatchFlyDetailModal({
  visible,
  fly,
  entry,
  inFlyBox,
  canAddToFlyBox,
  onClose,
  onAddToFlyBox,
  onViewImage,
}: Props) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const accent = entry ? hatchCategoryColor(entry.category, colors) : colors.primary;
  const imageSource = fly ? getBundledFlyImageSource(fly.name) : null;
  const stageLabel = fly ? HATCH_FLY_STAGE_LABELS[fly.stage] : null;

  const showModal = visible && fly != null && entry != null;

  return (
    <Modal
      visible={showModal}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
        {/* Inner press guard so taps on the card don't close the sheet. */}
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />

          {fly && entry ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              <View style={styles.headerRow}>
                <Pressable
                  onPress={onViewImage}
                  disabled={!imageSource || !onViewImage}
                  accessibilityRole={imageSource && onViewImage ? 'button' : undefined}
                  accessibilityLabel={imageSource && onViewImage ? `View ${fly.name} full screen` : undefined}
                >
                  {imageSource ? (
                    <Image source={imageSource} style={styles.image} resizeMode="cover" />
                  ) : (
                    <View style={[styles.image, styles.imagePlaceholder]}>
                      <Ionicons name="bug-outline" size={30} color={colors.textTertiary} />
                    </View>
                  )}
                </Pressable>
                <View style={styles.headerMain}>
                  <Text style={styles.name}>{fly.name}</Text>
                  <View style={styles.badgeRow}>
                    {stageLabel ? (
                      <View style={[styles.stageBadge, { borderColor: accent, backgroundColor: colors.surfaceElevated }]}>
                        <Text style={[styles.stageBadgeText, { color: accent }]}>{stageLabel}</Text>
                      </View>
                    ) : null}
                    {fly.size ? <Text style={styles.size}>{fly.size}</Text> : null}
                  </View>
                  {inFlyBox ? (
                    <View style={styles.inBoxRow}>
                      <Ionicons name="checkmark-circle" size={15} color={colors.success ?? accent} />
                      <Text style={[styles.inBoxText, { color: colors.success ?? accent }]}>In your fly box</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              <View style={[styles.matchCard, { borderColor: colors.border }]}>
                <Text style={[styles.matchLabel, { color: accent }]}>Matches {entry.name}</Text>
                <Text style={styles.matchSummary}>{entry.peakSummary}</Text>
                <View style={styles.rigList}>
                  <DetailLine label="Sizes" value={entry.sizes} accent={accent} styles={styles} />
                  <DetailLine label="Water" value={entry.water} accent={accent} styles={styles} />
                  <DetailLine label="Tip" value={entry.tip} accent={accent} styles={styles} />
                </View>
              </View>

              {canAddToFlyBox ? (
                <Pressable
                  style={[
                    styles.addButton,
                    { backgroundColor: inFlyBox ? colors.surfaceElevated : accent },
                  ]}
                  onPress={onAddToFlyBox}
                  accessibilityRole="button"
                  accessibilityLabel={inFlyBox ? `Add another ${fly.name} to your fly box` : `Add ${fly.name} to your fly box`}
                >
                  <Ionicons
                    name={inFlyBox ? 'add-circle-outline' : 'add'}
                    size={20}
                    color={inFlyBox ? accent : colors.textInverse}
                  />
                  <Text style={[styles.addButtonText, { color: inFlyBox ? accent : colors.textInverse }]}>
                    {inFlyBox ? 'Add another to fly box' : 'Add to fly box'}
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DetailLine({
  label,
  value,
  accent,
  styles,
}: {
  label: string;
  value: string;
  accent: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Text style={styles.detailLine}>
      <Text style={[styles.detailKey, { color: accent }]}>{label} </Text>
      {value}
    </Text>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      paddingTop: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      maxHeight: '82%',
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      alignSelf: 'center',
      marginBottom: Spacing.md,
    },
    scrollContent: {
      paddingBottom: Spacing.sm,
    },
    headerRow: {
      flexDirection: 'row',
      gap: Spacing.md,
      alignItems: 'center',
      marginBottom: Spacing.lg,
    },
    image: {
      width: 84,
      height: 84,
      borderRadius: BorderRadius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    imagePlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerMain: {
      flex: 1,
      minWidth: 0,
      gap: 6,
    },
    name: {
      fontSize: FontSize.lg,
      fontWeight: '800',
      color: colors.text,
    },
    badgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    stageBadge: {
      paddingVertical: 3,
      paddingHorizontal: 9,
      borderRadius: BorderRadius.md,
      borderWidth: StyleSheet.hairlineWidth,
    },
    stageBadgeText: {
      fontSize: FontSize.xs,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    size: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    inBoxRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    inBoxText: {
      fontSize: FontSize.xs,
      fontWeight: '700',
    },
    matchCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      marginBottom: Spacing.lg,
      backgroundColor: colors.surfaceElevated,
    },
    matchLabel: {
      fontSize: FontSize.xs,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 4,
    },
    matchSummary: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
    },
    rigList: {
      gap: Spacing.xs,
    },
    detailLine: {
      fontSize: FontSize.sm,
      color: colors.text,
      lineHeight: 21,
    },
    detailKey: {
      fontWeight: '800',
    },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
    },
    addButtonText: {
      fontSize: FontSize.md,
      fontWeight: '700',
    },
  });
}
