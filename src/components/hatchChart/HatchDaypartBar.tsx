import type { DaypartWeights } from '@/src/data/driftGuideHatchChart';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { StyleSheet, Text, View } from 'react-native';

const PARTS = [
  { key: 'dawn' as const, label: 'Dawn' },
  { key: 'morning' as const, label: 'AM' },
  { key: 'midday' as const, label: 'Mid' },
  { key: 'afternoon' as const, label: 'PM' },
  { key: 'evening' as const, label: 'Eve' },
  { key: 'night' as const, label: 'Night' },
];

type Props = {
  daypart: DaypartWeights;
  colors: ThemeColors;
  accent: string;
};

export function HatchDaypartBar({ daypart, colors, accent }: Props) {
  const raw = PARTS.map((p) => Math.max(0.05, daypart[p.key]));
  const sum = raw.reduce((a, b) => a + b, 0);
  return (
    <View style={styles.wrap}>
      <Text style={[styles.caption, { color: colors.textTertiary }]}>Time of day (share of activity)</Text>
      <View style={[styles.bar, { backgroundColor: colors.borderLight }]}>
        {PARTS.map((p, i) => {
          const flex = raw[i]! / sum;
          return (
            <View
              key={p.key}
              style={{
                flex,
                minWidth: 2,
                backgroundColor: accent,
                opacity: 0.3 + flex * 0.7,
                borderRightWidth: i < PARTS.length - 1 ? StyleSheet.hairlineWidth : 0,
                borderRightColor: colors.surface,
              }}
            />
          );
        })}
      </View>
      <View style={styles.labelRow}>
        {PARTS.map((p, i) => (
          <View key={p.key} style={{ flex: raw[i]! / sum, minWidth: 0 }}>
            <Text style={[styles.label, { color: colors.textTertiary }]} numberOfLines={1}>
              {p.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing.sm,
  },
  caption: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  bar: {
    flexDirection: 'row',
    height: 14,
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
  },
  labelRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  label: {
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
});
