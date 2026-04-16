import { HatchEntryVisualCard } from '@/src/components/hatchChart/HatchEntryVisualCard';
import { HatchYearMatrix } from '@/src/components/hatchChart/HatchYearMatrix';
import {
  DRIFTGUIDE_HATCH_CHART_ENTRIES,
  DRIFTGUIDE_HATCH_CHART_INTRO,
  entriesStrongThisMonth,
  hatchEntriesSortedByCategory,
} from '@/src/data/driftGuideHatchChart';
import { hatchCategoryColor } from '@/src/components/hatchChart/hatchChartTheme';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.xl,
    },
    hero: {
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    heroTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    heroMonth: {
      fontSize: FontSize.xl,
      fontWeight: '800',
      color: colors.text,
      fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: undefined }),
    },
    heroSub: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 21,
      marginBottom: Spacing.sm,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    chip: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: BorderRadius.md,
      borderWidth: StyleSheet.hairlineWidth,
    },
    chipText: {
      fontSize: FontSize.xs,
      fontWeight: '700',
    },
    intro: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 22,
      marginBottom: Spacing.md,
    },
    sectionTitle: {
      fontSize: FontSize.sm,
      fontWeight: '800',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: Spacing.sm,
    },
    footer: {
      marginTop: Spacing.md,
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      lineHeight: 18,
      fontStyle: 'italic',
    },
  });
}

export default function HatchChartScreen() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const now = useMemo(() => new Date(), []);
  const monthIndex0 = now.getMonth();
  const monthName = format(now, 'MMMM');
  const strongNow = useMemo(
    () => entriesStrongThisMonth(DRIFTGUIDE_HATCH_CHART_ENTRIES, monthIndex0, 2),
    [monthIndex0],
  );
  const sorted = useMemo(() => hatchEntriesSortedByCategory(DRIFTGUIDE_HATCH_CHART_ENTRIES), []);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: Spacing.xl + insets.bottom }]}
    >
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <MaterialCommunityIcons name="calendar-month" size={26} color={colors.secondary} />
          <Text style={styles.heroMonth}>{monthName}</Text>
        </View>
        <Text style={styles.heroSub}>
          Hatches marked &quot;good&quot; or &quot;prime&quot; this month on our reference calendar. Elevation, flow, and
          tailwater vs freestone shift timing.
        </Text>
        {strongNow.length > 0 ? (
          <View style={styles.chipRow}>
            {strongNow.map((e) => {
              const ac = hatchCategoryColor(e.category, colors);
              return (
                <View key={e.id} style={[styles.chip, { borderColor: ac, backgroundColor: colors.surfaceElevated }]}>
                  <Text style={[styles.chipText, { color: ac }]}>{e.shortLabel}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={[styles.heroSub, { marginBottom: 0 }]}>
            Fewer headline hatches this month on the chart—midges, small mayflies, and nymphing still carry most days.
          </Text>
        )}
      </View>

      <Text style={styles.intro}>{DRIFTGUIDE_HATCH_CHART_INTRO}</Text>

      <HatchYearMatrix currentMonthIndex0={monthIndex0} colors={colors} />

      <Text style={styles.sectionTitle}>Each hatch — graphs + tap for rig notes</Text>
      {sorted.map((e) => (
        <HatchEntryVisualCard key={e.id} entry={e} currentMonthIndex0={monthIndex0} colors={colors} />
      ))}

      <Text style={styles.footer}>
        DriftGuide hatch calendar — planning reference only. Respect access, closures, and what you actually observe on
        the water.
      </Text>
    </ScrollView>
  );
}
