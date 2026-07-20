import { HatchDaypartBar } from '@/src/components/hatchChart/HatchDaypartBar';
import { HatchMonthHeatstrip } from '@/src/components/hatchChart/HatchMonthHeatstrip';
import { hatchCategoryColor } from '@/src/components/hatchChart/hatchChartTheme';
import {
  bestWindowLabel,
  hatchActivityForMonth,
  type DriftGuideHatchChartEntry,
} from '@/src/data/driftGuideHatchChart';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  entry: DriftGuideHatchChartEntry;
  currentMonthIndex0: number;
  colors: ThemeColors;
  /** Controlled expanded state (drives the rig-note detail + any expanded children). */
  open: boolean;
  onToggle: () => void;
  /** Rendered inside the expanded section, after the rig notes (e.g. the matching-flies strip). */
  expandedExtra?: ReactNode;
};

export function HatchEntryVisualCard({ entry, currentMonthIndex0, colors, open, onToggle, expandedExtra }: Props) {
  const accent = hatchCategoryColor(entry.category, colors);
  const styles = useMemo(() => createCardStyles(colors, accent), [colors, accent]);

  const level = hatchActivityForMonth(entry, currentMonthIndex0);
  const best = useMemo(() => bestWindowLabel(entry.daypart), [entry.daypart]);
  const flyCount = entry.flies.length;

  return (
    <View style={styles.card}>
      {/* Tapping anywhere on the hatch (title or charts) toggles the rig-notes + flies dropdown. */}
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [pressed && { opacity: 0.9 }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint="Shows or hides sizes, water, tip, and matching flies"
      >
        <View style={styles.topRow}>
          <View style={[styles.catStripe, { backgroundColor: accent }]} />
          <View style={styles.topMain}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={2}>
                {entry.name}
              </Text>
              {level >= 2 ? (
                <View
                  style={[
                    styles.levelPill,
                    { backgroundColor: level === 3 ? accent : colors.surfaceElevated, borderColor: accent },
                  ]}
                >
                  <Text style={[styles.levelPillText, { color: level === 3 ? colors.textInverse : accent }]}>
                    {level === 3 ? 'Prime' : 'Good'}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.summary} numberOfLines={2}>
              {entry.peakSummary}
            </Text>
          </View>
        </View>

        <View style={styles.chartBlock}>
          <Text style={styles.sectionLabel}>Season by month</Text>
          <HatchMonthHeatstrip
            months={entry.monthActivity}
            currentMonthIndex0={currentMonthIndex0}
            category={entry.category}
            colors={colors}
          />
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="clock-time-four-outline" size={13} color={colors.textTertiary} />
            <Text style={styles.metaText}>
              Best <Text style={{ color: colors.text, fontWeight: '700' }}>{best.toLowerCase()}</Text>
            </Text>
            <View style={styles.metaDot} />
            <Text style={styles.metaText}>{flyCount} matching flies</Text>
          </View>
          <HatchDaypartBar daypart={entry.daypart} colors={colors} accent={accent} />
        </View>

        {/* Dropdown affordance, directly above where the content opens (below the time-of-day scale). */}
        <View style={[styles.expandToggle, { borderTopColor: colors.border }]}>
          <Text style={[styles.expandLabel, { color: accent }]}>
            {open ? 'Hide rig notes & flies' : 'Rig notes & matching flies'}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={accent} />
        </View>
      </Pressable>

      {open ? (
        <View style={[styles.detail, { borderTopColor: colors.border }]}>
          <Text style={styles.detailLine}>
            <Text style={styles.detailKey}>Sizes </Text>
            {entry.sizes}
          </Text>
          <Text style={styles.detailLine}>
            <Text style={styles.detailKey}>Water </Text>
            {entry.water}
          </Text>
          <Text style={styles.detailLine}>
            <Text style={styles.detailKey}>Tip </Text>
            {entry.tip}
          </Text>
          {expandedExtra}
        </View>
      ) : null}
    </View>
  );
}

function createCardStyles(colors: ThemeColors, accent: string) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: Spacing.md,
      overflow: 'hidden',
    },
    topRow: {
      flexDirection: 'row',
    },
    catStripe: {
      width: 4,
    },
    topMain: {
      flex: 1,
      paddingVertical: Spacing.sm,
      paddingRight: Spacing.sm,
      paddingLeft: Spacing.sm,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm,
    },
    name: {
      flex: 1,
      fontSize: FontSize.md,
      fontWeight: '800',
      color: colors.text,
    },
    levelPill: {
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: BorderRadius.full,
      borderWidth: StyleSheet.hairlineWidth,
      marginTop: 1,
    },
    levelPillText: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    summary: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      marginTop: 4,
      lineHeight: 18,
    },
    expandToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    expandLabel: {
      fontSize: FontSize.xs,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    chartBlock: {
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.sm,
      paddingTop: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    sectionLabel: {
      fontSize: FontSize.xs,
      fontWeight: '800',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 6,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: Spacing.sm,
      marginBottom: 2,
    },
    metaText: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      fontWeight: '600',
    },
    metaDot: {
      width: 3,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: colors.textTertiary,
    },
    detail: {
      borderTopWidth: StyleSheet.hairlineWidth,
      padding: Spacing.md,
      gap: Spacing.sm,
    },
    detailLine: {
      fontSize: FontSize.sm,
      color: colors.text,
      lineHeight: 21,
    },
    detailKey: {
      fontWeight: '800',
      color: accent,
    },
  });
}
