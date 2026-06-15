import { HatchEntryVisualCard } from '@/src/components/hatchChart/HatchEntryVisualCard';
import { HatchYearMatrix } from '@/src/components/hatchChart/HatchYearMatrix';
import {
  DRIFTGUIDE_HATCH_CHART_ENTRIES,
  DRIFTGUIDE_HATCH_CHART_INTRO,
  entriesStrongThisMonth,
  hatchEntriesSortedByCategory,
  hatchFliesByStage,
  type DriftGuideHatchChartEntry,
  type HatchFly,
} from '@/src/data/driftGuideHatchChart';
import { hatchCategoryColor } from '@/src/components/hatchChart/hatchChartTheme';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import type { FlyChangeData } from '@/src/types';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useCallback, useMemo } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Parse the first hook size out of a hint like '#18–22' for FlyChangeData.size. */
function parseFlySize(size: string | undefined): number | null {
  if (!size) return null;
  const m = size.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** Build a catch fly-picker payload from a tapped matching fly. */
function flyToFlyChangeData(fly: HatchFly): FlyChangeData {
  return {
    pattern: fly.name,
    size: parseFlySize(fly.size),
    color: null,
    photo_url: null,
  };
}

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
    fliesCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginTop: -Spacing.xs,
      marginBottom: Spacing.md,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
    },
    fliesHeader: {
      fontSize: FontSize.xs,
      fontWeight: '800',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: Spacing.sm,
    },
    fliesStageLabel: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      marginBottom: 6,
    },
    fliesStrip: {
      gap: Spacing.sm,
      paddingRight: Spacing.md,
    },
    flyItem: {
      width: 76,
      alignItems: 'center',
    },
    flyImage: {
      width: 64,
      height: 64,
      borderRadius: BorderRadius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    flyName: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginTop: 4,
    },
    flySize: {
      fontSize: 10,
      color: colors.textTertiary,
      textAlign: 'center',
    },
  });
}

type MatchingFliesStripProps = {
  entry: DriftGuideHatchChartEntry;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  onSelectFly: (fly: HatchFly, entry: DriftGuideHatchChartEntry) => void;
};

/** Horizontal "Matching flies" strip, grouped by life stage, with bundled fly images. */
function MatchingFliesStrip({ entry, colors, styles, onSelectFly }: MatchingFliesStripProps) {
  const groups = useMemo(() => hatchFliesByStage(entry), [entry]);
  const accent = hatchCategoryColor(entry.category, colors);
  if (groups.length === 0) return null;

  return (
    <View style={styles.fliesCard}>
      <Text style={styles.fliesHeader}>Matching flies</Text>
      {groups.map((group) => (
        <View key={group.stage} style={{ marginBottom: Spacing.sm }}>
          <Text style={[styles.fliesStageLabel, { color: accent }]}>{group.label}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fliesStrip}>
            {group.flies.map((fly) => {
              const source = getBundledFlyImageSource(fly.name);
              return (
                <Pressable
                  key={`${group.stage}-${fly.name}`}
                  style={({ pressed }) => [styles.flyItem, pressed && { opacity: 0.7 }]}
                  onPress={() => onSelectFly(fly, entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`${fly.name}${fly.size ? `, ${fly.size}` : ''}`}
                  accessibilityHint="Use this fly when logging a catch"
                >
                  {source ? (
                    <Image source={source} style={styles.flyImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.flyImage} />
                  )}
                  <Text style={styles.flyName} numberOfLines={2}>
                    {fly.name}
                  </Text>
                  {fly.size ? <Text style={styles.flySize}>{fly.size}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ))}
    </View>
  );
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

  const handleSelectFly = useCallback((fly: HatchFly, entry: DriftGuideHatchChartEntry) => {
    // Build the catch fly-picker payload now so wiring is trivial later.
    const flyChange = flyToFlyChangeData(fly);
    // TODO(WS-E): pre-fill the catch fly-picker with `flyChange`. The hatch chart is a standalone
    // pushed screen with no active trip/catch context, so opening TripFlyPatternPickerModal /
    // CatchDetailsModal from here needs a cross-screen flow (navigate to active trip, then open the
    // picker seeded with this FlyChangeData). Left as a callback to avoid an intrusive refactor.
    void flyChange;
    void entry;
  }, []);

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
        <View key={e.id}>
          <HatchEntryVisualCard entry={e} currentMonthIndex0={monthIndex0} colors={colors} />
          <MatchingFliesStrip entry={e} colors={colors} styles={styles} onSelectFly={handleSelectFly} />
        </View>
      ))}

      <Text style={styles.footer}>
        DriftGuide hatch calendar — planning reference only. Respect access, closures, and what you actually observe on
        the water.
      </Text>
    </ScrollView>
  );
}
