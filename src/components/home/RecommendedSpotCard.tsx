import {
  computeDriftGuideCompositeScore,
  internalRawFromCounts,
} from '@/src/services/driftGuideScore';
import type { HomeHotSpotData } from '@/src/utils/homeHotSpots';
import { formatDistanceLabel } from '@/src/utils/homeHotSpots';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { WaterClarity } from '@/src/types';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useMemo, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function conditionTierLabel(stars: number): string {
  if (stars >= 4.25) return 'Prime';
  if (stars >= 3.25) return 'Good';
  if (stars >= 2) return 'Fair';
  return 'Tough';
}

/** Tier color drives the score pill + top-pick accent so the ranking reads at a glance. */
function tierColor(colors: ThemeColors, stars: number): string {
  if (stars >= 4.25) return colors.success;
  if (stars >= 3.25) return colors.secondary;
  if (stars >= 2) return colors.warning;
  return colors.textTertiary;
}

function outlookLabel(stars: number): { text: string; positive: boolean } {
  if (stars >= 4) return { text: 'Strong', positive: true };
  if (stars >= 2.5) return { text: 'Mixed', positive: false };
  return { text: 'Tough', positive: false };
}

function clarityShort(c: WaterClarity): string {
  const map: Record<WaterClarity, string> = {
    clear: 'Clear',
    slightly_stained: 'Slight stain',
    stained: 'Stained',
    murky: 'Murky',
    blown_out: 'Blown out',
    unknown: '—',
  };
  return map[c] ?? '—';
}

function windCompassFromSpeed(speed: number): string {
  if (speed < 1) return 'Calm';
  return `${Math.round(speed)} mph`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm + Spacing.xs, // 12 — tighter so all 3 waters fit without scrolling
      marginBottom: Spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      // A soft lift so each water reads as its own tappable surface.
      shadowColor: colors.shadow,
      shadowOpacity: 1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    cardTopPick: {
      borderColor: colors.secondary,
      borderWidth: 1.5,
    },
    // A tinted rail down the left edge ties the card to its tier color.
    accentRail: {
      position: 'absolute',
      left: 0,
      top: Spacing.sm + Spacing.xs,
      bottom: Spacing.sm + Spacing.xs,
      width: 3,
      borderTopRightRadius: BorderRadius.full,
      borderBottomRightRadius: BorderRadius.full,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    rank: {
      width: 26,
      height: 26,
      borderRadius: BorderRadius.full,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    rankText: {
      fontSize: FontSize.xs,
      fontWeight: '800',
    },
    titleBlock: {
      flex: 1,
      minWidth: 0,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    name: {
      flexShrink: 1,
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    topPickTag: {
      flexShrink: 0,
      backgroundColor: colors.secondary,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.full,
    },
    topPickTagText: {
      fontSize: 9,
      fontWeight: '800',
      color: colors.textInverse,
      letterSpacing: 0.6,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      marginTop: 2,
    },
    meta: {
      flexShrink: 1,
      fontSize: FontSize.xs,
      color: colors.textTertiary,
    },
    communityChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      flexShrink: 0,
    },
    communityChipText: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    // Solid tier-colored score pill — the headline ranking signal.
    scorePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 5,
      borderRadius: BorderRadius.full,
      flexShrink: 0,
    },
    scoreNum: {
      fontSize: FontSize.sm,
      fontWeight: '800',
      color: colors.textInverse,
    },
    // Condition pills wrap onto a second line rather than cramping.
    pillsRow: {
      marginTop: Spacing.sm,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    conditionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: BorderRadius.full,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 4,
    },
    conditionValue: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.text,
    },
    conditionValueHighlight: {
      color: colors.success,
    },
  });
}

function ConditionPill({
  icon,
  value,
  valueHighlight,
  colors,
  styles,
}: {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  value: string;
  valueHighlight?: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.conditionPill}>
      <MaterialCommunityIcons
        name={icon}
        size={13}
        color={valueHighlight ? colors.success : colors.textSecondary}
      />
      <Text
        style={[styles.conditionValue, valueHighlight && styles.conditionValueHighlight]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

export function RecommendedSpotCard({
  data,
  isTopPick,
  rank,
  onPress,
}: {
  data: HomeHotSpotData;
  isTopPick: boolean;
  /** 1-based standing within the ranked list; shown as a numbered chip. */
  rank?: number;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const n = data.communityFishN ?? 0;
  const iRaw = internalRawFromCounts(n, Math.min(n, Math.max(0, Math.ceil(n * 0.35))));
  const composite = computeDriftGuideCompositeScore({
    conditions: data.conditions,
    internalRaw: iRaw,
    communityFishN: n,
    external: null,
  });
  const scoreStars = composite.stars;
  const tier = conditionTierLabel(scoreStars);
  const outlook = outlookLabel(scoreStars);
  const dist = formatDistanceLabel(data.distanceKm);
  const c = data.conditions;
  const flow = c.water.flow_cfs;
  const flowStr =
    flow != null && Number.isFinite(flow)
      ? flow >= 1000
        ? `${(flow / 1000).toFixed(flow >= 10000 ? 0 : 1)}k cfs`
        : `${Math.round(flow)} cfs`
      : '—';
  const tempStr = Number.isFinite(c.temperature.temp_f)
    ? `${Math.round(c.temperature.temp_f)}°F`
    : null;
  const windStr = Number.isFinite(c.wind.speed_mph)
    ? windCompassFromSpeed(c.wind.speed_mph)
    : null;
  const clarity = clarityShort(c.water.clarity);
  const flowVal = flowStr === '—' ? null : flowStr;

  // Only show a pill when we actually have the reading — an empty "—" pill reads as broken.
  const conditionPills: {
    icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
    value: string;
    valueHighlight?: boolean;
  }[] = [
    tempStr ? { icon: 'thermometer' as const, value: tempStr } : null,
    flowVal ? { icon: 'waves' as const, value: flowVal } : null,
    windStr ? { icon: 'weather-windy' as const, value: windStr } : null,
    { icon: 'chart-line' as const, value: outlook.text, valueHighlight: outlook.positive },
  ].filter((p): p is NonNullable<typeof p> => p != null);

  // Drop unknown clarity ("—") so the meta line never trails a lone dash.
  const metaParts = [dist, tier, clarity === '—' ? null : clarity]
    .filter(Boolean)
    .join(' · ');
  const tint = tierColor(colors, scoreStars);
  const hasCommunity = data.communityRatingAvg != null && (data.communityRatingCount ?? 0) > 0;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, isTopPick && styles.cardTopPick]}
      accessibilityRole="button"
      accessibilityLabel={`${data.location.name}, ${tier} conditions, ${scoreStars.toFixed(1)} out of five`}
      accessibilityHint="Opens full fishing report, conditions, and map for this water"
    >
      <View style={[styles.accentRail, { backgroundColor: tint }]} />
      <View style={styles.topRow}>
        {rank != null ? (
          <View
            style={[
              styles.rank,
              isTopPick
                ? { backgroundColor: tint }
                : { backgroundColor: colors.surfaceElevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.rankText, { color: isTopPick ? colors.textInverse : colors.textSecondary }]}>
              {rank}
            </Text>
          </View>
        ) : null}
        <View style={styles.titleBlock}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {data.location.name}
            </Text>
            {isTopPick ? (
              <View style={styles.topPickTag}>
                <Text style={styles.topPickTagText}>TOP PICK</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.meta} numberOfLines={1}>
              {metaParts}
            </Text>
            {hasCommunity ? (
              <View style={styles.communityChip}>
                <Ionicons name="people" size={11} color={colors.textSecondary} />
                <Text style={styles.communityChipText}>
                  {data.communityRatingAvg!.toFixed(1)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={[styles.scorePill, { backgroundColor: tint }]}>
          <Ionicons name="star" size={12} color={colors.textInverse} />
          <Text style={styles.scoreNum}>{scoreStars.toFixed(1)}</Text>
        </View>
      </View>
      <View style={styles.pillsRow}>
        {conditionPills.map((p) => (
          <ConditionPill
            key={p.icon}
            icon={p.icon}
            value={p.value}
            valueHighlight={p.valueHighlight}
            colors={colors}
            styles={styles}
          />
        ))}
      </View>
    </Pressable>
  );
}

export function recommendedSpotsLoadingStyles(colors: ThemeColors) {
  return StyleSheet.create({
    loadingBox: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.xl,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    emptyBox: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.lg,
      paddingHorizontal: Spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    emptyText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 19,
    },
  });
}
