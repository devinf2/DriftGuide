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
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.sm,
      marginBottom: Spacing.sm,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    cardTopPick: {
      borderColor: colors.secondary,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    titleBlock: {
      flex: 1,
      minWidth: 0,
    },
    name: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.text,
    },
    badge: {
      alignSelf: 'flex-start',
      marginTop: Spacing.xs,
      backgroundColor: colors.secondary,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 3,
      borderRadius: BorderRadius.sm,
    },
    badgeText: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.textInverse,
      letterSpacing: 0.5,
    },
    ratingColumn: {
      alignItems: 'flex-end',
      flexShrink: 0,
    },
    ratingBlock: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingTop: 1,
    },
    ratingNum: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.warning,
    },
    metaRow: {
      marginTop: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    meta: {
      flex: 1,
      minWidth: 0,
      fontSize: FontSize.xs,
      color: colors.textTertiary,
    },
    reportLink: {
      flexShrink: 0,
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.secondary,
      textDecorationLine: 'underline',
    },
    metricsRow: {
      marginTop: Spacing.sm,
      flexDirection: 'row',
      gap: 4,
      paddingVertical: 2,
    },
    metricCard: {
      flex: 1,
      minWidth: 0,
      backgroundColor: colors.surfaceElevated,
      borderRadius: BorderRadius.sm,
      paddingVertical: 6,
      paddingHorizontal: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: 'center',
    },
    metricIcon: {
      marginBottom: 2,
    },
    metricLabel: {
      fontSize: 9,
      color: colors.textTertiary,
      marginBottom: 1,
      textAlign: 'center',
    },
    metricValue: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    metricValueHighlight: {
      color: colors.secondary,
    },
  });
}

function MetricMini({
  icon,
  label,
  value,
  valueHighlight,
  colors,
  styles,
}: {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  value: string;
  valueHighlight?: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.metricCard}>
      <MaterialCommunityIcons
        name={icon}
        size={14}
        color={colors.textTertiary}
        style={styles.metricIcon}
      />
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.metricValue, valueHighlight && styles.metricValueHighlight]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {value}
      </Text>
    </View>
  );
}

export function RecommendedSpotCard({
  data,
  isTopPick,
  onPress,
}: {
  data: HomeHotSpotData;
  isTopPick: boolean;
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
  const tempStr = `${Math.round(c.temperature.temp_f)}°F`;
  const windStr = windCompassFromSpeed(c.wind.speed_mph);
  const clarity = clarityShort(c.water.clarity);

  const metaParts = [dist, tier, clarity].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, isTopPick && styles.cardTopPick]}
      accessibilityRole="button"
      accessibilityHint="Opens full fishing report, conditions, and map for this water"
    >
      <View style={styles.topRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.name} numberOfLines={2}>
            {data.location.name}
          </Text>
          {isTopPick ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>TOP PICK</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.ratingColumn}>
          <View style={styles.ratingBlock}>
            <Ionicons name="star" size={14} color={colors.warning} />
            <Text style={styles.ratingNum}>{scoreStars.toFixed(1)}</Text>
          </View>
        </View>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.meta} numberOfLines={1}>
          {metaParts}
        </Text>
        <Text style={styles.reportLink}>Fishing report</Text>
      </View>
      <View style={styles.metricsRow}>
        <MetricMini
          icon="thermometer"
          label="Temp"
          value={tempStr}
          colors={colors}
          styles={styles}
        />
        <MetricMini icon="waves" label="Flow" value={flowStr} colors={colors} styles={styles} />
        <MetricMini icon="weather-windy" label="Wind" value={windStr} colors={colors} styles={styles} />
        <MetricMini
          icon="chart-line"
          label="Outlook"
          value={outlook.text}
          valueHighlight={outlook.positive}
          colors={colors}
          styles={styles}
        />
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
