import { DRIFTGUIDE_HATCH_CHART_ENTRIES, MONTH_LABELS_SHORT } from '@/src/data/driftGuideHatchChart';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { activityCellColor } from '@/src/components/hatchChart/hatchChartTheme';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  currentMonthIndex0: number;
  colors: ThemeColors;
};

export function HatchYearMatrix({ currentMonthIndex0, colors }: Props) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Year at a glance</Text>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>
        Each square is a month (J–D). Darker = more worth planning around. Bold column = this month.
      </Text>
      <View style={styles.headerRow}>
        <View style={styles.labelSpacer} />
        {MONTH_LABELS_SHORT.map((m, i) => (
          <View key={m + i} style={styles.headCellWrap}>
            <Text
              style={[
                styles.headCell,
                { color: colors.textTertiary },
                i === currentMonthIndex0 && { color: colors.secondary, fontWeight: '800' },
              ]}
            >
              {m}
            </Text>
          </View>
        ))}
      </View>
      {DRIFTGUIDE_HATCH_CHART_ENTRIES.map((row) => (
        <View key={row.id} style={styles.dataRow}>
          <Text style={[styles.rowLabel, { color: colors.textSecondary }]} numberOfLines={1}>
            {row.shortLabel}
          </Text>
          {row.monthActivity.map((level, i) => (
            <View
              key={i}
              style={[
                styles.matrixCell,
                { backgroundColor: activityCellColor(level, colors) },
                i === currentMonthIndex0 && { borderWidth: 1.5, borderColor: colors.secondary },
              ]}
            />
          ))}
        </View>
      ))}
      <View style={[styles.legend, { borderTopColor: colors.border }]}>
        {[0, 1, 2, 3].map((lvl) => (
          <View key={lvl} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: activityCellColor(lvl, colors) }]} />
            <Text style={[styles.legendText, { color: colors.textTertiary }]}>
              {lvl === 0 ? 'Off' : lvl === 1 ? 'Low' : lvl === 2 ? 'Good' : 'Prime'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const CELL = 16;
const LABEL_W = 44;

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize.md,
    fontWeight: '800',
    marginBottom: 4,
  },
  sub: {
    fontSize: FontSize.xs,
    lineHeight: 17,
    marginBottom: Spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  labelSpacer: {
    width: LABEL_W,
  },
  headCellWrap: {
    width: CELL,
    marginRight: 2,
    alignItems: 'center',
  },
  headCell: {
    textAlign: 'center',
    fontSize: 9,
    fontWeight: '700',
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  rowLabel: {
    width: LABEL_W,
    fontSize: 10,
    fontWeight: '600',
    paddingRight: 4,
  },
  matrixCell: {
    width: CELL,
    height: CELL,
    borderRadius: 3,
    marginRight: 2,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 2,
  },
  legendText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
});
