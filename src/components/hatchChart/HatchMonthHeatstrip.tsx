import { MONTH_LABELS_SHORT, type MonthActivity } from '@/src/data/driftGuideHatchChart';
import { BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { activityCellColor, hatchCategoryColor } from '@/src/components/hatchChart/hatchChartTheme';
import type { HatchCategory } from '@/src/data/driftGuideHatchChart';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  months: readonly MonthActivity[];
  currentMonthIndex0: number;
  category: HatchCategory;
  colors: ThemeColors;
  compact?: boolean;
};

export function HatchMonthHeatstrip({ months, currentMonthIndex0, category, colors, compact }: Props) {
  const cat = hatchCategoryColor(category, colors);
  return (
    <View>
      <View style={styles.row}>
        {months.map((level, i) => {
          const isCurrent = i === currentMonthIndex0;
          return (
            <View
              key={i}
              style={[
                styles.cell,
                compact && styles.cellCompact,
                { backgroundColor: activityCellColor(level, colors) },
                isCurrent && { borderWidth: 2, borderColor: cat },
              ]}
              accessibilityLabel={`${MONTH_LABELS_SHORT[i]} ${level === 0 ? 'low' : level === 1 ? 'possible' : level === 2 ? 'good' : 'prime'} activity`}
            />
          );
        })}
      </View>
      <View style={[styles.row, styles.labelsRow]}>
        {MONTH_LABELS_SHORT.map((m, i) => (
          <Text
            key={m + i}
            style={[
              styles.monthLetter,
              compact && styles.monthLetterCompact,
              { color: i === currentMonthIndex0 ? colors.text : colors.textTertiary },
              i === currentMonthIndex0 && { fontWeight: '800', color: cat },
            ]}
          >
            {m}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 3,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    height: 22,
    borderRadius: BorderRadius.sm,
  },
  cellCompact: {
    height: 14,
    borderRadius: 3,
  },
  labelsRow: {
    marginTop: 4,
    justifyContent: 'space-between',
  },
  monthLetter: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '600',
  },
  monthLetterCompact: {
    fontSize: 8,
  },
});
