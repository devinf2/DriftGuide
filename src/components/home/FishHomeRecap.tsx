import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import { CatchSpotlightCard } from '@/src/components/home/CatchSpotlightCard';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import type { CatchSpotlight } from '@/src/hooks/useRecentCatchesRecap';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { CatchRow } from '@/src/types';
import { formatRelativeTime } from '@/src/utils/formatters';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

type Props = {
  recentCatches: CatchRow[];
  totalCatches: number;
  spotlight: CatchSpotlight | null;
  /** Trip id → location name, used when a tapped strip catch is promoted to the spotlight. */
  locationNameByTripId: Record<string, string | null>;
  loading: boolean;
  onOpenCatch: (row: CatchRow) => void;
  onSeeAll: () => void;
  onStartFirstTrip?: () => void;
};

function catchHeroUrl(row: CatchRow): string | null {
  if (row.photo_url) return row.photo_url;
  if (Array.isArray(row.photo_urls) && row.photo_urls.length > 0) return row.photo_urls[0];
  return null;
}

function catchSizeLabel(row: CatchRow): string | null {
  return row.size_inches != null ? `${row.size_inches}"` : null;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sheet: {
      paddingTop: Spacing.md,
      paddingBottom: Spacing.md,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    sectionTitle: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
    },
    seeAllBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    seeAllText: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.primary,
    },
    // Wrapping grid beneath the spotlight — flows vertically in the page scroll.
    catchGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: Spacing.lg,
      gap: Spacing.md,
    },
    catchCard: {
      width: 76,
    },
    catchThumb: {
      width: 76,
      height: 76,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surfaceElevated,
    },
    catchThumbPlaceholder: {
      width: 76,
      height: 76,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    catchSpecies: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.text,
      marginTop: Spacing.xs,
    },
    catchMeta: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 1,
    },
    emptyCard: {
      marginHorizontal: Spacing.lg,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: Spacing.lg,
      alignItems: 'center',
      gap: Spacing.sm,
    },
    emptyText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    emptyCta: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      marginTop: Spacing.xs,
    },
    emptyCtaText: {
      color: colors.textInverse,
      fontWeight: '700',
      fontSize: FontSize.sm,
    },
    skeletonThumb: {
      width: 76,
      height: 76,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surfaceElevated,
      opacity: 0.6,
    },
  });
}

function CatchThumb({
  row,
  style,
  placeholderStyle,
  iconColor,
}: {
  row: CatchRow;
  style: object;
  placeholderStyle: object;
  iconColor: string;
}) {
  const url = catchHeroUrl(row);
  if (!url) {
    return (
      <View style={placeholderStyle}>
        <MaterialCommunityIcons name="fish" size={30} color={iconColor} />
      </View>
    );
  }
  if (url.startsWith('http')) {
    return <OfflineTripPhotoImage remoteUri={url} maxPixelSize={400} style={style} contentFit="cover" />;
  }
  return (
    <Image source={{ uri: url }} style={style} contentFit="cover" cachePolicy="memory-disk" recyclingKey={url} transition={120} />
  );
}

/** Welcome tab's bottom sheet: a look back at recent catches + the last trip. */
export function FishHomeRecap({
  recentCatches,
  totalCatches,
  spotlight,
  locationNameByTripId,
  loading,
  onOpenCatch,
  onSeeAll,
  onStartFirstTrip,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  // Four thumbnails per row: fill the grid width minus its side padding and the 3 inter-card gaps.
  const cardW = Math.floor((width - Spacing.lg * 2 - Spacing.md * 3) / 4);
  const thumbSize = { width: cardW, height: cardW };
  const hasCatches = recentCatches.length > 0;
  const showEmpty = !loading && !hasCatches;

  // Tapping a strip catch promotes it into the spotlight; the daily pick is the default.
  const [promoted, setPromoted] = useState<CatchRow | null>(null);
  const featured: CatchSpotlight | null = useMemo(() => {
    if (promoted) {
      return {
        catch: promoted,
        reason: '',
        locationName: locationNameByTripId[promoted.trip_id] ?? null,
      };
    }
    return spotlight;
  }, [promoted, spotlight, locationNameByTripId]);

  // Don't repeat the featured catch immediately below itself in the strip.
  const stripCatches = useMemo(
    () => (featured ? recentCatches.filter((c) => c.id !== featured.catch.id) : recentCatches),
    [recentCatches, featured],
  );

  return (
    <View style={styles.sheet}>
      {showEmpty ? (
        <View style={styles.emptyCard}>
          <MaterialCommunityIcons name="fish" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>
            No catches logged yet. Start a trip and your recent catches and last outing will appear
            here.
          </Text>
          {onStartFirstTrip ? (
            <Pressable style={styles.emptyCta} onPress={onStartFirstTrip} accessibilityRole="button">
              <Text style={styles.emptyCtaText}>Start a trip</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          {featured ? <CatchSpotlightCard spotlight={featured} onOpen={onOpenCatch} /> : null}

          {loading && !hasCatches ? (
            <View style={styles.catchGrid}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={[styles.skeletonThumb, thumbSize]} />
              ))}
            </View>
          ) : stripCatches.length > 0 ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{featured ? 'More catches' : 'Recent catches'}</Text>
                {totalCatches > recentCatches.length ? (
                  <Pressable
                    style={styles.seeAllBtn}
                    onPress={onSeeAll}
                    accessibilityRole="button"
                    accessibilityLabel="See all catches"
                    hitSlop={8}
                  >
                    <Text style={styles.seeAllText}>See all</Text>
                    <MaterialCommunityIcons name="chevron-right" size={16} color={colors.primary} />
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.catchGrid}>
                {stripCatches.map((row) => {
                  const species = row.species?.trim() || 'Catch';
                  const size = catchSizeLabel(row);
                  return (
                    <Pressable
                      key={row.id}
                      style={[styles.catchCard, { width: cardW }]}
                      onPress={() => setPromoted(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`${species}${size ? `, ${size}` : ''}. Feature in spotlight.`}
                    >
                      <CatchThumb
                        row={row}
                        style={[styles.catchThumb, thumbSize]}
                        placeholderStyle={[styles.catchThumbPlaceholder, thumbSize]}
                        iconColor={colors.textTertiary}
                      />
                      <Text style={styles.catchSpecies} numberOfLines={1}>
                        {species}
                      </Text>
                      <Text style={styles.catchMeta} numberOfLines={1}>
                        {[size, formatRelativeTime(row.timestamp)].filter(Boolean).join(' · ')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
        </>
      )}
    </View>
  );
}
