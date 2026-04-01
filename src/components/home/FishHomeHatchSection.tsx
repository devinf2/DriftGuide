import { DriftGuideMessage } from '@/src/components/home/DriftGuideMessage';
import type { HatchBriefRow } from '@/src/services/ai';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

function hatchDotColor(tier: HatchBriefRow['tier'], colors: ThemeColors): string {
  if (tier === 'active') return colors.secondary;
  if (tier === 'starting') return colors.warning;
  if (tier === 'waning') return colors.textTertiary;
  return colors.textSecondary;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surfaceElevated,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
    },
    bugIcon: {
      marginRight: 2,
    },
    headerTitle: {
      flex: 1,
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.warning,
      fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: undefined }),
    },
    body: {
      paddingHorizontal: Spacing.sm,
      paddingBottom: Spacing.md,
      gap: Spacing.sm,
    },
    emptyText: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      lineHeight: 18,
      paddingHorizontal: Spacing.sm,
      paddingTop: Spacing.xs,
    },
    hatchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: Spacing.sm,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      flexShrink: 0,
    },
    hatchRowText: {
      flex: 1,
      minWidth: 0,
    },
    insectName: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.text,
    },
    sizeHint: {
      fontSize: FontSize.xs,
      fontWeight: '400',
      color: colors.textTertiary,
    },
    statusLabel: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      flexShrink: 0,
      marginLeft: Spacing.xs,
    },
    seeMoreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.sm,
    },
    seeMoreText: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.secondary,
    },
  });
}

const HATCH_PREVIEW = 2;
const HATCH_EXPANDED_MAX = 4;

export function FishHomeHatchSection({
  loading,
  rows,
}: {
  loading: boolean;
  rows?: HatchBriefRow[] | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showMoreHatches, setShowMoreHatches] = useState(false);
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const safeRows = Array.isArray(rows) ? rows : [];
  const visibleRows = showMoreHatches
    ? safeRows.slice(0, HATCH_EXPANDED_MAX)
    : safeRows.slice(0, HATCH_PREVIEW);
  const hasMoreToShow = safeRows.length > HATCH_PREVIEW;
  const moreCount = Math.min(HATCH_EXPANDED_MAX - HATCH_PREVIEW, safeRows.length - HATCH_PREVIEW);

  return (
    <DriftGuideMessage>
      <View style={styles.card}>
        <Pressable
          style={styles.headerRow}
          onPress={() => {
            setExpanded((e) => {
              if (e) setShowMoreHatches(false);
              return !e;
            });
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel="Hatch information"
        >
          <MaterialCommunityIcons name="bug" size={18} color={colors.warning} style={styles.bugIcon} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            Hatch Information
          </Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
        </Pressable>

        {expanded ? (
          <View style={styles.body}>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: Spacing.sm }} />
            ) : safeRows.length === 0 ? (
              <Text style={styles.emptyText}>
                Add waters in DriftGuide to see hatch notes tied to current conditions near you.
              </Text>
            ) : (
              <>
                {visibleRows.map((row, i) => (
                  <View key={`${row.insect}-${i}`} style={styles.hatchRow}>
                    <View style={[styles.statusDot, { backgroundColor: hatchDotColor(row.tier, colors) }]} />
                    <View style={styles.hatchRowText}>
                      <Text style={styles.insectName} numberOfLines={1}>
                        {row.insect}
                        {row.sizes ? (
                          <Text style={styles.sizeHint}>
                            {' '}
                            ({row.sizes})
                          </Text>
                        ) : null}
                      </Text>
                    </View>
                    <Text style={styles.statusLabel} numberOfLines={1}>
                      {row.status}
                    </Text>
                  </View>
                ))}
                {hasMoreToShow && !showMoreHatches ? (
                  <Pressable
                    style={styles.seeMoreRow}
                    onPress={() => setShowMoreHatches(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${moreCount} more hatches`}
                  >
                    <Text style={styles.seeMoreText}>
                      {moreCount === 1 ? 'Show 1 more' : `Show ${moreCount} more`}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={colors.secondary} />
                  </Pressable>
                ) : null}
                {hasMoreToShow && showMoreHatches ? (
                  <Pressable
                    style={styles.seeMoreRow}
                    onPress={() => setShowMoreHatches(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Show fewer hatches"
                  >
                    <Text style={styles.seeMoreText}>Show fewer</Text>
                    <Ionicons name="chevron-up" size={16} color={colors.secondary} />
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </View>
    </DriftGuideMessage>
  );
}
