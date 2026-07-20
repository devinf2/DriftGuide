import { HatchDaypartBar } from '@/src/components/hatchChart/HatchDaypartBar';
import { HatchMonthHeatstrip } from '@/src/components/hatchChart/HatchMonthHeatstrip';
import { activityCellColor, hatchCategoryColor } from '@/src/components/hatchChart/hatchChartTheme';
import {
  bestWindowLabel,
  hatchActivityForMonth,
  type DriftGuideHatchChartEntry,
} from '@/src/data/driftGuideHatchChart';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  entry: DriftGuideHatchChartEntry;
  currentMonthIndex0: number;
  colors: ThemeColors;
  open: boolean;
  onToggle: () => void;
  /** Rendered inside the expanded section, after the rig notes (the matching-flies strip). */
  expandedExtra?: ReactNode;
};

/**
 * Condensed hatch row for the "also active" tier: one scannable line (name + best window + a mini
 * season strip) that expands to the full season heatstrip, time-of-day bar, and rig notes + flies.
 */
export function HatchCompactRow({ entry, currentMonthIndex0, colors, open, onToggle, expandedExtra }: Props) {
  const accent = hatchCategoryColor(entry.category, colors);
  const styles = useMemo(() => createStyles(colors, accent), [colors, accent]);
  const level = hatchActivityForMonth(entry, currentMonthIndex0);
  const levelWord = level >= 2 ? 'Good' : level === 1 ? 'Low' : 'Off';
  const best = useMemo(() => bestWindowLabel(entry.daypart), [entry.daypart]);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${entry.name}, ${levelWord.toLowerCase()} this month`}
        accessibilityHint="Shows the season strip, time of day, rig notes, and matching flies"
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
      >
        <View style={[styles.stripe, { backgroundColor: accent }]} />
        <View style={styles.main}>
          <Text style={styles.name} numberOfLines={1}>
            {entry.name}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {levelWord} · best {best.toLowerCase()}
          </Text>
        </View>
        <View style={styles.mini}>
          {entry.monthActivity.map((lvl, i) => (
            <View
              key={i}
              style={[
                styles.miniCell,
                { backgroundColor: activityCellColor(lvl, colors) },
                i === currentMonthIndex0 && { borderWidth: 1.5, borderColor: accent },
              ]}
            />
          ))}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
      </Pressable>

      {open ? (
        <View style={[styles.detail, { borderTopColor: colors.border }]}>
          <Text style={styles.sectionLabel}>Season by month</Text>
          <HatchMonthHeatstrip
            months={entry.monthActivity}
            currentMonthIndex0={currentMonthIndex0}
            category={entry.category}
            colors={colors}
          />
          <View style={{ height: Spacing.sm }} />
          <HatchDaypartBar daypart={entry.daypart} colors={colors} accent={accent} />
          <View style={styles.notes}>
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
          </View>
          {expandedExtra}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors: ThemeColors, accent: string) {
  return StyleSheet.create({
    wrap: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: Spacing.sm,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingRight: Spacing.md,
    },
    stripe: {
      width: 4,
      alignSelf: 'stretch',
    },
    main: {
      flex: 1,
      minWidth: 0,
      paddingVertical: Spacing.sm,
    },
    name: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    sub: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 2,
    },
    mini: {
      flexDirection: 'row',
      gap: 2,
      flexShrink: 0,
    },
    miniCell: {
      width: 5,
      height: 15,
      borderRadius: 2,
    },
    detail: {
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
    },
    sectionLabel: {
      fontSize: FontSize.xs,
      fontWeight: '800',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 6,
    },
    notes: {
      marginTop: Spacing.sm,
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
