import { HatchActivitySparkline } from '@/src/components/hatchChart/HatchActivitySparkline';
import { HatchDaypartBar } from '@/src/components/hatchChart/HatchDaypartBar';
import { HatchMonthHeatstrip } from '@/src/components/hatchChart/HatchMonthHeatstrip';
import { hatchCategoryColor } from '@/src/components/hatchChart/hatchChartTheme';
import type { DriftGuideHatchChartEntry } from '@/src/data/driftGuideHatchChart';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, type ReactNode } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

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
  const [chartW, setChartW] = useState(280);
  const accent = hatchCategoryColor(entry.category, colors);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 48) setChartW(Math.floor(w));
  };

  const sparkH = 44;
  const styles = useMemo(() => createCardStyles(colors, accent), [colors, accent]);

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
            <Text style={styles.name} numberOfLines={2}>
              {entry.name}
            </Text>
            <Text style={styles.summary} numberOfLines={2}>
              {entry.peakSummary}
            </Text>
          </View>
        </View>

        <View style={styles.chartBlock} onLayout={onLayout}>
          <Text style={styles.sectionLabel}>Season by month</Text>
          <HatchMonthHeatstrip
            months={entry.monthActivity}
            currentMonthIndex0={currentMonthIndex0}
            category={entry.category}
            colors={colors}
          />
          <View style={styles.sparkWrap}>
            <HatchActivitySparkline months={entry.monthActivity} strokeColor={accent} width={chartW} height={sparkH} />
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
    name: {
      fontSize: FontSize.md,
      fontWeight: '800',
      color: colors.text,
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
    sparkWrap: {
      marginTop: Spacing.sm,
      alignItems: 'center',
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
