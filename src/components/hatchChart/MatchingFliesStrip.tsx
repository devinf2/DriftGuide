import { hatchCategoryColor } from '@/src/components/hatchChart/hatchChartTheme';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import {
  hatchFliesByStage,
  type DriftGuideHatchChartEntry,
  type HatchFly,
} from '@/src/data/driftGuideHatchChart';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = {
  entry: DriftGuideHatchChartEntry;
  colors: ThemeColors;
  onSelectFly: (fly: HatchFly, entry: DriftGuideHatchChartEntry) => void;
};

/**
 * Horizontal "Matching flies" strip, grouped by life stage, with bundled fly images. Shared by the
 * hatch calendar (taps open the fly detail sheet) and the home Suggested-Fly card (taps deep-link
 * into the calendar). The tap behavior is entirely up to the caller's onSelectFly.
 */
export function MatchingFliesStrip({ entry, colors, onSelectFly }: Props) {
  const groups = useMemo(() => hatchFliesByStage(entry), [entry]);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const accent = hatchCategoryColor(entry.category, colors);
  if (groups.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>Matching flies</Text>
      {groups.map((group) => (
        <View key={group.stage} style={{ marginBottom: Spacing.sm }}>
          <Text style={[styles.stageLabel, { color: accent }]}>{group.label}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {group.flies.map((fly) => {
              const source = getBundledFlyImageSource(fly.name);
              return (
                <Pressable
                  key={`${group.stage}-${fly.name}`}
                  style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}
                  onPress={() => onSelectFly(fly, entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`${fly.name}${fly.size ? `, ${fly.size}` : ''}`}
                >
                  {source ? (
                    <Image source={source} style={styles.image} resizeMode="cover" />
                  ) : (
                    <View style={styles.image} />
                  )}
                  <Text style={styles.name} numberOfLines={2}>
                    {fly.name}
                  </Text>
                  {fly.size ? <Text style={styles.size}>{fly.size}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      marginTop: Spacing.sm,
      paddingTop: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    header: {
      fontSize: FontSize.xs,
      fontWeight: '800',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: Spacing.sm,
    },
    stageLabel: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      marginBottom: 6,
    },
    strip: {
      gap: Spacing.sm,
      paddingRight: Spacing.md,
    },
    item: {
      width: 76,
      alignItems: 'center',
    },
    image: {
      width: 64,
      height: 64,
      borderRadius: BorderRadius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    name: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginTop: 4,
    },
    size: {
      fontSize: 10,
      color: colors.textTertiary,
      textAlign: 'center',
    },
  });
}
