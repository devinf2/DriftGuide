import { hatchCategoryColor } from '@/src/components/hatchChart/hatchChartTheme';
import type { HatchCategory } from '@/src/data/driftGuideHatchChart';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

export type HatchFilter = HatchCategory | 'all';

const CATEGORY_LABELS: Record<HatchCategory, string> = {
  midge: 'Midge',
  mayfly: 'Mayfly',
  caddis: 'Caddis',
  stone: 'Stone',
  terrestrial: 'Terrestrial',
  stillwater: 'Stillwater',
};

type Props = {
  /** Categories to offer, in display order (typically those present on the chart). */
  categories: HatchCategory[];
  value: HatchFilter;
  onChange: (value: HatchFilter) => void;
  colors: ThemeColors;
};

/** Horizontally scrolling category filter for the hatch calendar. "All" clears the filter. */
export function HatchCategoryFilter({ categories, value, onChange, colors }: Props) {
  const styles = createStyles(colors);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
    >
      <Chip
        label="All"
        active={value === 'all'}
        activeColor={colors.secondary}
        onPress={() => onChange('all')}
        styles={styles}
      />
      {categories.map((cat) => {
        const accent = hatchCategoryColor(cat, colors);
        return (
          <Chip
            key={cat}
            label={CATEGORY_LABELS[cat]}
            dotColor={accent}
            active={value === cat}
            activeColor={accent}
            onPress={() => onChange(cat)}
            styles={styles}
          />
        );
      })}
    </ScrollView>
  );
}

function Chip({
  label,
  dotColor,
  active,
  activeColor,
  onPress,
  styles,
}: {
  label: string;
  dotColor?: string;
  active: boolean;
  activeColor: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: activeColor, borderColor: activeColor },
        pressed && { opacity: 0.8 },
      ]}
    >
      {dotColor && !active ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      gap: Spacing.xs,
      paddingVertical: 2,
      paddingRight: Spacing.md,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 13,
      borderRadius: BorderRadius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    chipText: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    chipTextActive: {
      color: colors.textInverse,
      fontWeight: '700',
    },
  });
}
