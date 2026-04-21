import { DRIFTGUIDE_HATCH_CHART_ENTRIES, MONTH_LABELS_SHORT } from '@/src/data/driftGuideHatchChart';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { activityCellColor } from '@/src/components/hatchChart/hatchChartTheme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  currentMonthIndex0: number;
  colors: ThemeColors;
};

export function HatchYearMatrix({ currentMonthIndex0, colors }: Props) {
  const currentColumnBorder = colors.water;
  const [truncatedRowIds, setTruncatedRowIds] = useState<Set<string>>(() => new Set());
  const [nameTipRowId, setNameTipRowId] = useState<string | null>(null);

  const onRowLabelTextLayout = useCallback(
    (rowId: string, shortLabel: string, lines: { text: string }[]) => {
      const line0 = lines[0]?.text?.replace(/\u2026/g, '...').trim();
      if (line0 == null) return;
      const truncated = line0 !== shortLabel.trim();
      setTruncatedRowIds((prev) => {
        const was = prev.has(rowId);
        if (was === truncated) return prev;
        const next = new Set(prev);
        if (truncated) next.add(rowId);
        else next.delete(rowId);
        return next;
      });
    },
    [],
  );

  const nameTipEntry =
    nameTipRowId != null ? DRIFTGUIDE_HATCH_CHART_ENTRIES.find((e) => e.id === nameTipRowId) : undefined;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Year at a glance</Text>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>
        Each square is a month (J–D). Darker = more worth planning around. Ringed column = this month. Tap a clipped
        hatch name to see the full label.
      </Text>
      {nameTipEntry ? (
        <View
          style={[
            styles.nameTipBar,
            { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.nameTipText, { color: colors.text }]} numberOfLines={3}>
            {nameTipEntry.name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss hatch name"
            hitSlop={12}
            onPress={() => setNameTipRowId(null)}
            style={({ pressed }) => [styles.nameTipClose, pressed && { opacity: 0.6 }]}
          >
            <MaterialCommunityIcons name="close" size={20} color={colors.textTertiary} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.grid}>
        <View style={styles.labelColumn}>
          <View style={styles.headerLabelSpacer} />
          {DRIFTGUIDE_HATCH_CHART_ENTRIES.map((row) => {
            const isTruncated = truncatedRowIds.has(row.id);
            const labelBody = (
              <Text
                style={[
                  styles.rowLabel,
                  { color: colors.textSecondary },
                  isTruncated && styles.rowLabelTappable,
                  isTruncated && { color: colors.water },
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
                onTextLayout={(e) => onRowLabelTextLayout(row.id, row.shortLabel, e.nativeEvent.lines)}
              >
                {row.shortLabel}
              </Text>
            );
            return (
              <View key={row.id} style={styles.rowLabelWrap}>
                {isTruncated ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${row.shortLabel}, full name`}
                    accessibilityHint="Shows full hatch name"
                    onPress={() =>
                      setNameTipRowId((prev) => (prev === row.id ? null : row.id))
                    }
                    style={({ pressed }) => [
                      styles.rowLabelHit,
                      pressed && styles.rowLabelPressed,
                    ]}
                  >
                    {labelBody}
                  </Pressable>
                ) : (
                  labelBody
                )}
              </View>
            );
          })}
        </View>
        {MONTH_LABELS_SHORT.map((m, monthIndex) => {
          const isCurrent = monthIndex === currentMonthIndex0;
          return (
            <View
              key={m + monthIndex}
              style={[
                styles.monthColumn,
                {
                  borderColor: isCurrent ? currentColumnBorder : 'transparent',
                  backgroundColor: isCurrent ? `${currentColumnBorder}18` : 'transparent',
                },
              ]}
            >
              <Text
                style={[
                  styles.headCell,
                  { color: colors.textTertiary },
                  isCurrent && { color: currentColumnBorder, fontWeight: '800' },
                ]}
              >
                {m}
              </Text>
              {DRIFTGUIDE_HATCH_CHART_ENTRIES.map((entry) => {
                const level = entry.monthActivity[monthIndex] ?? 0;
                return (
                  <View
                    key={entry.id}
                    style={[
                      styles.matrixCell,
                      { backgroundColor: activityCellColor(level, colors) },
                    ]}
                  />
                );
              })}
            </View>
          );
        })}
      </View>
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
/** Border on every month column so current month can show a ring without shifting layout. */
const MONTH_COLUMN_BORDER = 2;
const MONTH_COLUMN_GAP = 2;

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
  grid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  labelColumn: {
    width: LABEL_W,
    marginRight: MONTH_COLUMN_GAP,
  },
  headerLabelSpacer: {
    height: 14,
    marginBottom: 4,
  },
  rowLabelWrap: {
    width: LABEL_W,
    height: CELL + 3,
    justifyContent: 'center',
    marginBottom: 0,
  },
  rowLabelHit: {
    alignSelf: 'stretch',
  },
  rowLabel: {
    fontSize: 10,
    fontWeight: '600',
    paddingRight: 4,
  },
  rowLabelTappable: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },
  rowLabelPressed: {
    opacity: 0.75,
  },
  nameTipBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
  },
  nameTipText: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: '600',
    lineHeight: 20,
  },
  nameTipClose: {
    marginTop: -2,
    marginRight: -2,
    padding: 2,
  },
  monthColumn: {
    /** Outer width: room for 2px border inside the layout box (RN) so 16px cells still fit. */
    width: CELL + MONTH_COLUMN_BORDER * 2,
    marginRight: MONTH_COLUMN_GAP,
    alignItems: 'center',
    borderRadius: BorderRadius.sm,
    borderWidth: MONTH_COLUMN_BORDER,
  },
  headCell: {
    textAlign: 'center',
    fontSize: 9,
    fontWeight: '700',
    marginBottom: 4,
    height: 14,
  },
  matrixCell: {
    width: CELL,
    height: CELL,
    borderRadius: 3,
    marginBottom: 3,
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
