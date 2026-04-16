import { HatchActivitySparkline } from '@/src/components/hatchChart/HatchActivitySparkline';
import { HatchDaypartBar } from '@/src/components/hatchChart/HatchDaypartBar';
import { HatchMonthHeatstrip } from '@/src/components/hatchChart/HatchMonthHeatstrip';
import { hatchCategoryColor } from '@/src/components/hatchChart/hatchChartTheme';
import type { DriftGuideHatchChartEntry } from '@/src/data/driftGuideHatchChart';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  entry: DriftGuideHatchChartEntry;
  currentMonthIndex0: number;
  colors: ThemeColors;
};

export function HatchEntryVisualCard({ entry, currentMonthIndex0, colors }: Props) {
  const [open, setOpen] = useState(false);
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
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.topRow, pressed && { opacity: 0.9 }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint="Shows or hides sizes, water, and tip"
      >
        <View style={[styles.catStripe, { backgroundColor: accent }]} />
        <View style={styles.topMain}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={2}>
              {entry.name}
            </Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textTertiary} />
          </View>
          <Text style={styles.summary} numberOfLines={2}>
            {entry.peakSummary}
          </Text>
        </View>
      </Pressable>

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
    titleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.xs,
    },
    name: {
      flex: 1,
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
