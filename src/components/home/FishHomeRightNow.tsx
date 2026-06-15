import { DriftGuideMessage } from '@/src/components/home/DriftGuideMessage';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { getFlyOfTheDay } from '@/src/services/ai';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import {
  buildRightNowTake,
  chooseRecommendedFly,
  selectPrimeHatchesForMonth,
  type RecommendedFly,
} from '@/src/utils/homeRightNow';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.md,
    },
    headerTitle: {
      fontSize: FontSize.xs,
      fontWeight: '800',
      color: colors.secondary,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
    },
    take: {
      fontSize: FontSize.md,
      color: colors.text,
      lineHeight: 22,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
    },
    flyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      marginHorizontal: Spacing.md,
      marginBottom: Spacing.md,
      padding: Spacing.sm,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    flyImage: {
      width: 56,
      height: 56,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.background,
    },
    flyImageFallback: {
      width: 56,
      height: 56,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    flyTextCol: {
      flex: 1,
      minWidth: 0,
    },
    flyKicker: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    flyName: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
      marginTop: 1,
    },
    flyMeta: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 2,
    },
    hatchChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.md,
    },
    chip: {
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    chipText: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.text,
    },
    fallbackRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      marginHorizontal: Spacing.md,
      marginBottom: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.secondary,
    },
    fallbackText: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.secondary,
    },
  });
}

type Props = {
  /** Number of nearby waters the hot-spot ranking found (0 for guest / no GPS / no catalog). */
  rankedWatersCount: number;
  /** Whether we have a GPS fix (drives the location-aware copy + AI region). */
  userCoords: { latitude: number; longitude: number } | null;
  /** Signed-in user id, if any. Enables the AI "fly of the day" upgrade; null-safe for guests. */
  userId?: string | null;
  /** Top ranked water name + one-line conditions, when available, to sharpen the AI fly pick. */
  topWaterName?: string | null;
  /** Shown when we have neither GPS nor ranked waters: a still-useful escape hatch. */
  onBrowseMap?: () => void;
};

/**
 * Home hero: "where should I fish near me right now, and what do I tie on?" with zero data entry.
 * Combines ranked nearby waters (count from useHomeHotSpots) + this month's prime hatches
 * (driftGuideHatchChart) + a single recommended fly. We show a local hatch-derived fly instantly,
 * then upgrade it with the AI fly_of_the_day when a user/coords are present. Renders usefully for a
 * brand-new guest (no user, no GPS, no waters).
 */
export function FishHomeRightNow({
  rankedWatersCount,
  userCoords,
  userId,
  topWaterName,
  onBrowseMap,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const monthIndex0 = new Date().getMonth();
  const primeHatches = useMemo(() => selectPrimeHatchesForMonth(monthIndex0, 3), [monthIndex0]);
  /** Instant local default so the hero never waits on the network. */
  const localFly = useMemo<RecommendedFly>(
    () => chooseRecommendedFly(primeHatches, (name) => getBundledFlyImageSource(name) != null),
    [primeHatches],
  );
  const [aiFlyName, setAiFlyName] = useState<string | null>(null);
  const [aiFlyMeta, setAiFlyMeta] = useState<string | null>(null);

  const hasLocation = userCoords != null;
  const take = useMemo(
    () =>
      buildRightNowTake({
        rankedWatersCount,
        primeHatches,
        recommendedFly: localFly,
        hasLocation,
      }),
    [rankedWatersCount, primeHatches, localFly, hasLocation],
  );

  /** Upgrade the local pick with the AI fly_of_the_day once we have a user (guests keep the local pick). */
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void getFlyOfTheDay(userId, {
      locationName: topWaterName ?? undefined,
      userLat: userCoords?.latitude ?? null,
      userLng: userCoords?.longitude ?? null,
    })
      .then((rec) => {
        if (cancelled || !rec?.pattern) return;
        // Only adopt the AI pick if we have art for it; otherwise the local hatch fly already shows.
        if (getBundledFlyImageSource(rec.pattern) == null) return;
        setAiFlyName(rec.pattern);
        setAiFlyMeta(
          [rec.size ? `#${rec.size}` : null, rec.color].filter(Boolean).join(' ') || null,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, topWaterName, userCoords?.latitude, userCoords?.longitude]);

  const flyName = aiFlyName ?? localFly.name;
  const flyImage = getBundledFlyImageSource(flyName);
  const flyMeta =
    aiFlyName != null
      ? aiFlyMeta ?? undefined
      : localFly.sizes ?? (localFly.forHatch ? localFly.forHatch.peakSummary : undefined);

  const showFallback = rankedWatersCount === 0 && !hasLocation && Boolean(onBrowseMap);

  return (
    <DriftGuideMessage>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <MaterialCommunityIcons name="map-marker-radius" size={16} color={colors.secondary} />
          <Text style={styles.headerTitle}>Right now near you</Text>
        </View>

        <Text style={styles.take}>{take}</Text>

        <View style={styles.flyRow}>
          {flyImage ? (
            <Image source={flyImage} style={styles.flyImage} contentFit="cover" />
          ) : (
            <View style={styles.flyImageFallback}>
              <MaterialCommunityIcons name="hook" size={24} color={colors.textTertiary} />
            </View>
          )}
          <View style={styles.flyTextCol}>
            <Text style={styles.flyKicker}>Tie on</Text>
            <Text style={styles.flyName} numberOfLines={1}>
              {flyName}
            </Text>
            {flyMeta ? (
              <Text style={styles.flyMeta} numberOfLines={1}>
                {flyMeta}
              </Text>
            ) : null}
          </View>
        </View>

        {primeHatches.length > 0 ? (
          <View style={styles.hatchChips}>
            {primeHatches.map(({ entry }) => (
              <View key={entry.id} style={styles.chip}>
                <Text style={styles.chipText}>{entry.shortLabel}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {showFallback ? (
          <Pressable
            style={styles.fallbackRow}
            onPress={onBrowseMap}
            accessibilityRole="button"
            accessibilityLabel="Browse the map to pick a region"
          >
            <MaterialCommunityIcons name="map-search-outline" size={18} color={colors.secondary} />
            <Text style={styles.fallbackText}>Browse the map to pick a region</Text>
          </Pressable>
        ) : null}
      </View>
    </DriftGuideMessage>
  );
}
