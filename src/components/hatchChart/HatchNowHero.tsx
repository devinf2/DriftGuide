import {
  bestWindowLabel,
  daypartKeyForHour,
  hatchActivityForMonth,
  hatchDaypartShare,
  primaryFlyForHatch,
  type DriftGuideHatchChartEntry,
  type HatchFly,
} from '@/src/data/driftGuideHatchChart';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

// Deep-teal ground for the featured card — same in both themes so it always reads as the one
// live "right now" answer, with white text guaranteed high-contrast over it.
const HERO_BG = '#0C5A66';
const HERO_INK = '#ECFCFD';
const HERO_INK_MUTED = 'rgba(236, 252, 253, 0.74)';
const HERO_PANEL = 'rgba(255, 255, 255, 0.13)';
const HERO_PANEL_BORDER = 'rgba(255, 255, 255, 0.18)';

type Props = {
  entry: DriftGuideHatchChartEntry;
  monthIndex0: number;
  hour: number;
  colors: ThemeColors;
  /** Tap the "tie on" fly → open the fly detail sheet (rig notes, add to fly box). */
  onSelectFly: (fly: HatchFly, entry: DriftGuideHatchChartEntry) => void;
};

/** Time-aware featured card: the one hatch most worth fishing right now, and the fly to tie on. */
export function HatchNowHero({ entry, monthIndex0, hour, colors, onSelectFly }: Props) {
  const key = daypartKeyForHour(hour);
  const level = hatchActivityForMonth(entry, monthIndex0);
  const best = useMemo(() => bestWindowLabel(entry.daypart), [entry.daypart]);
  const activeNow = hatchDaypartShare(entry, key) >= 0.18;
  const fly = useMemo(() => primaryFlyForHatch(entry), [entry]);
  const flySource = fly ? getBundledFlyImageSource(fly.name) : undefined;

  const timeLabel = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(2000, 0, 1, hour, new Date().getMinutes()),
  );

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.liveRow}>
        <View style={styles.livePill}>
          <View style={styles.dot} />
          <Text style={styles.livePillText}>On the water now</Text>
        </View>
        <Text style={styles.timeText}>
          {timeLabel} · {activeNow ? 'prime window' : `best ${best.toLowerCase()}`}
        </Text>
      </View>

      <View style={styles.nameRow}>
        <Text style={styles.name} numberOfLines={2}>
          {entry.name}
        </Text>
        <View style={styles.levelPill}>
          <Text style={styles.levelPillText}>{level === 3 ? 'Prime' : 'Good'}</Text>
        </View>
      </View>
      <Text style={styles.summary} numberOfLines={2}>
        {entry.peakSummary}
      </Text>

      <View style={styles.metaRow}>
        <MaterialCommunityIcons name="clock-time-four-outline" size={14} color={HERO_INK_MUTED} />
        <Text style={styles.metaText}>
          {activeNow ? `Active now — peak window ${best.toLowerCase()}` : `Warming up — best ${best.toLowerCase()}`}
        </Text>
      </View>

      {fly ? (
        <Pressable
          onPress={() => onSelectFly(fly, entry)}
          accessibilityRole="button"
          accessibilityLabel={`Tie on ${fly.name}${fly.size ? `, ${fly.size}` : ''}`}
          accessibilityHint="Opens this fly to view or add to your fly box"
          style={({ pressed }) => [styles.tie, pressed && { opacity: 0.85 }]}
        >
          {flySource ? (
            <Image source={flySource} style={styles.tieImage} resizeMode="cover" />
          ) : (
            <View style={styles.tieImage} />
          )}
          <View style={styles.tieMain}>
            <Text style={styles.tieLabel}>Tie on</Text>
            <Text style={styles.tieFly} numberOfLines={1}>
              {fly.name}
              {fly.size ? ` · ${fly.size}` : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={HERO_INK_MUTED} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: HERO_BG,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: HERO_PANEL,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: BorderRadius.full,
  },
  livePillText: {
    color: HERO_INK,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#7DFFDF',
  },
  timeText: {
    color: HERO_INK_MUTED,
    fontSize: FontSize.xs,
    fontWeight: '600',
    flexShrink: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  name: {
    flex: 1,
    color: HERO_INK,
    fontSize: FontSize.xl,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  levelPill: {
    backgroundColor: '#7DFFDF',
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: BorderRadius.full,
    marginTop: 2,
  },
  levelPillText: {
    color: '#08424B',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  summary: {
    color: HERO_INK_MUTED,
    fontSize: FontSize.sm,
    marginTop: 4,
    lineHeight: 19,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.sm,
  },
  metaText: {
    color: HERO_INK,
    fontSize: FontSize.sm,
    fontWeight: '600',
    flexShrink: 1,
  },
  tie: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: HERO_PANEL,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HERO_PANEL_BORDER,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    marginTop: Spacing.md,
  },
  tieImage: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  tieMain: {
    flex: 1,
    minWidth: 0,
  },
  tieLabel: {
    color: HERO_INK_MUTED,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tieFly: {
    color: HERO_INK,
    fontSize: FontSize.md,
    fontWeight: '700',
    marginTop: 1,
  },
});
