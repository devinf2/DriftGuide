import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import type { CatchData, Trip, TripEvent } from '@/src/types';
import { resolveCatchHeroPhotoUrl } from '@/src/utils/catchPhotos';
import { formatEventTime, formatTemperature, formatTripDuration } from '@/src/utils/formatters';
import { inferActiveFishingMsFromPauseResumeEvents } from '@/src/utils/tripTiming';
import { totalFishFromEvents } from '@/src/utils/journalTimeline';
import { displayFlyName } from '@/src/utils/flyValidation';
import { type TripFlyWithPhoto } from '@/src/utils/getTripFliesWithPhotos';
import { CLARITY_LABELS } from '@/src/services/waterFlow';
import { buildTripRecap, catchesBySizeDesc, formatHourWindowLabel } from '@/src/utils/tripRecap';

export interface TripRecapProps {
  trip: Trip;
  events: TripEvent[];
  colors: ThemeColors;
  /** Winning fly by catch count (first entry of getTripFliesWithPhotos), if any fish were logged on a fly. */
  topFly: TripFlyWithPhoto | null;
  albumPhotoUrlsByCatchId?: ReadonlyMap<string, readonly string[]>;
  /** Opens the full-screen catch photo viewer (same handler the timeline uses). */
  onCatchPhotoPress?: (event: TripEvent) => void;
  /** Opens the trip review modal from the Rating tile. Omit to render rating read-only. */
  onEditRating?: () => void;
  /**
   * `trip` (default) — a single angler's recap: biggest, total, top fly, hot bite, duration, rating.
   * `group` — the merged session recap: total is the group total and the per-person Duration /
   *   Rating tiles are omitted (they don't apply to a group).
   */
  variant?: 'trip' | 'group';
}

type TileTint = 'gold' | 'blue' | 'teal' | 'green' | 'slate';
type RecapTile = {
  key: string;
  tint: TileTint;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  /** Small count shown on the right of the header row (e.g. "11 fish"). */
  count?: string;
  onPress?: () => void;
  editable?: boolean;
};

/** Best catch that actually has a resolvable photo (falls back through smaller fish). */
function useHeroCatch(
  events: TripEvent[],
  albumPhotoUrlsByCatchId?: ReadonlyMap<string, readonly string[]>,
): { event: TripEvent; url: string; data: CatchData } | null {
  return useMemo(() => {
    for (const ev of catchesBySizeDesc(events)) {
      const data = ev.data as CatchData;
      const url = resolveCatchHeroPhotoUrl(ev.id, data, albumPhotoUrlsByCatchId);
      if (url) return { event: ev, url, data };
    }
    return null;
  }, [events, albumPhotoUrlsByCatchId]);
}

export function TripRecap({
  trip,
  events,
  colors,
  topFly,
  albumPhotoUrlsByCatchId,
  onCatchPhotoPress,
  onEditRating,
  variant = 'trip',
}: TripRecapProps) {
  const styles = useMemo(() => createTripRecapStyles(colors), [colors]);
  const recap = useMemo(() => buildTripRecap(events), [events]);
  const hero = useHeroCatch(events, albumPhotoUrlsByCatchId);
  const isGroup = variant === 'group';

  // Group total sums everyone's catches from the merged events; a single trip trusts its stored count.
  const totalFish = isGroup ? totalFishFromEvents(events) : (trip.total_fish ?? totalFishFromEvents(events));

  const durationLabel = useMemo(() => {
    let ms: number | null | undefined = trip.active_fishing_ms;
    if ((ms == null || ms === 0) && events.length > 0) {
      const inferred = inferActiveFishingMsFromPauseResumeEvents(trip.start_time, trip.end_time, events);
      if (inferred != null) ms = inferred;
    }
    return formatTripDuration(trip.start_time, trip.end_time, {
      imported: trip.imported,
      activeFishingMs: ms ?? undefined,
    });
  }, [trip, events]);

  const biggestLabel = useMemo(() => {
    const b = recap.biggest;
    if (!b) return null;
    if (b.sizeInches != null) return `${b.sizeInches}″ ${b.species ?? 'fish'}`.trim();
    if (b.weightLabel) return `${b.weightLabel} ${b.species ?? 'fish'}`.trim();
    return b.species ?? null;
  }, [recap.biggest]);

  const ratingReviewed =
    trip.rating != null ||
    (trip.user_reported_clarity != null && trip.user_reported_clarity !== 'unknown') ||
    (trip.notes?.trim() ?? '') !== '';

  const tiles = useMemo(() => {
    const out: RecapTile[] = [];

    if (recap.biggest && biggestLabel) {
      out.push({
        key: 'biggest',
        tint: 'gold',
        icon: <MaterialCommunityIcons name="trophy" size={12} color={colors.warning} />,
        label: 'Biggest',
        value: <Text style={styles.tileValue} numberOfLines={2}>{biggestLabel}</Text>,
      });
    }

    out.push({
      key: 'total',
      tint: 'blue',
      icon: <MaterialCommunityIcons name="fish" size={12} color={colors.primaryLight} />,
      label: 'Total fish',
      value: <Text style={styles.tileValue}>{totalFish}</Text>,
    });

    if (topFly && topFly.catchCount > 0) {
      out.push({
        key: 'topfly',
        tint: 'blue',
        icon: <MaterialCommunityIcons name="hook" size={12} color={colors.primaryLight} />,
        label: 'Top fly',
        count: `${topFly.catchCount} fish`,
        value: <Text style={styles.tileValue} numberOfLines={2}>{displayFlyName(topFly.pattern)}</Text>,
      });
    }

    if (recap.hotHour) {
      out.push({
        key: 'hothour',
        tint: 'teal',
        icon: <MaterialIcons name="schedule" size={12} color={colors.secondary} />,
        label: 'Hot bite',
        count: `${recap.hotHour.count} fish`,
        value: <Text style={styles.tileValue}>{formatHourWindowLabel(recap.hotHour.startHour)}</Text>,
      });
    }

    // Duration and Rating are per-person — omit them from the merged group recap.
    if (!isGroup) {
      out.push({
        key: 'duration',
        tint: 'slate',
        icon: <MaterialIcons name="timer" size={12} color={colors.textSecondary} />,
        label: 'Duration',
        value: <Text style={styles.tileValue}>{durationLabel}</Text>,
      });

      out.push({
        key: 'rating',
        tint: 'gold',
        icon: <MaterialIcons name="star" size={12} color={colors.warning} />,
        label: 'Rating',
        editable: onEditRating != null,
        onPress: onEditRating,
        value:
          trip.rating != null ? (
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <MaterialIcons
                  key={n}
                  name={n <= trip.rating! ? 'star' : 'star-border'}
                  size={15}
                  color={n <= trip.rating! ? colors.warning : colors.border}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.tileValue}>—</Text>
          ),
      });
    }

    return out;
  }, [recap, biggestLabel, totalFish, topFly, durationLabel, trip.rating, onEditRating, isGroup, colors, styles]);

  const tints = tintMap(colors);

  if (!hero && tiles.length === 0) return null;

  const heroData = hero?.data;
  const heroTitle = heroData
    ? heroData.size_inches != null
      ? `${heroData.species?.trim() || 'Catch'} · ${heroData.size_inches}″`
      : heroData.species?.trim() || 'Catch'
    : '';
  const heroFly = topFly ? displayFlyName(topFly.pattern) : null;
  const isHeroBiggest = hero != null && recap.biggest?.event.id === hero.event.id;

  // Water conditions ride the hero as a chip (rather than a lone 7th tile).
  const waterChip = recap.water
    ? [
        recap.water.tempF != null ? formatTemperature(recap.water.tempF) : null,
        recap.water.clarity ? CLARITY_LABELS[recap.water.clarity] : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <View style={styles.wrap}>
      {hero ? (
        <Pressable
          style={styles.hero}
          onPress={() => onCatchPhotoPress?.(hero.event)}
          accessibilityRole="button"
          accessibilityLabel={`View ${heroTitle} full screen`}
        >
          <Image
            source={{ uri: hero.url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={180}
            accessibilityIgnoresInvertColors
          />
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <SvgLinearGradient id="heroScrim" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0.35" stopColor="#060E18" stopOpacity="0" />
                <Stop offset="0.6" stopColor="#060E18" stopOpacity="0.15" />
                <Stop offset="1" stopColor="#060E18" stopOpacity="0.82" />
              </SvgLinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroScrim)" />
          </Svg>
          {waterChip ? (
            <View style={styles.heroChip}>
              <MaterialCommunityIcons name="waves" size={12} color="#fff" />
              <Text style={styles.heroChipText}>{waterChip}</Text>
            </View>
          ) : null}
          {isHeroBiggest ? (
            <View style={styles.heroTag}>
              <MaterialCommunityIcons name="trophy" size={12} color="#3a2a02" />
              <Text style={styles.heroTagText}>Fish of the day</Text>
            </View>
          ) : null}
          <View style={styles.heroMeta}>
            <Text style={styles.heroSpecies} numberOfLines={1}>
              {heroTitle}
            </Text>
            <Text style={styles.heroSub} numberOfLines={1}>
              {formatEventTime(hero.event.timestamp)}
              {heroFly ? ` · ${heroFly}` : ''}
            </Text>
          </View>
        </Pressable>
      ) : null}

      <Text style={styles.sectionLabel}>Trip recap</Text>
      <View style={styles.tileGrid}>
        {tiles.map((t) => {
          const Wrapper: typeof Pressable | typeof View = t.onPress ? Pressable : View;
          return (
            <Wrapper
              key={t.key}
              style={styles.tile}
              {...(t.onPress
                ? {
                    onPress: t.onPress,
                    accessibilityRole: 'button' as const,
                    accessibilityLabel: `${t.label}, edit`,
                  }
                : {})}
            >
              <View style={styles.tileHead}>
                <View style={styles.tileHeadLeft}>
                  <View style={[styles.tileIcon, { backgroundColor: tints[t.tint] }]}>{t.icon}</View>
                  <Text style={styles.tileLabel} numberOfLines={1}>{t.label}</Text>
                </View>
                {t.count ? (
                  <Text style={styles.tileCount}>{t.count}</Text>
                ) : t.editable ? (
                  <MaterialIcons
                    name="edit"
                    size={13}
                    color={ratingReviewed ? colors.primary : colors.textSecondary}
                  />
                ) : null}
              </View>
              {t.value}
            </Wrapper>
          );
        })}
      </View>
    </View>
  );
}

function tintMap(c: ThemeColors): Record<TileTint, string> {
  return {
    gold: `${c.warning}2E`,
    blue: `${c.primaryLight}2E`,
    teal: `${c.secondary}2E`,
    green: `${c.success}2A`,
    slate: `${c.textSecondary}26`,
  };
}

function createTripRecapStyles(c: ThemeColors) {
  return StyleSheet.create({
    wrap: { gap: Spacing.sm },
    hero: {
      aspectRatio: 16 / 10,
      borderRadius: BorderRadius.lg,
      overflow: 'hidden',
      backgroundColor: c.surfaceElevated,
      borderWidth: 1,
      borderColor: c.border,
    },
    heroChip: {
      position: 'absolute',
      top: Spacing.sm,
      left: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: 'rgba(6,14,24,0.55)',
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: BorderRadius.full,
    },
    heroChipText: { fontSize: FontSize.xs, fontWeight: '600', color: '#fff' },
    heroTag: {
      position: 'absolute',
      top: Spacing.sm,
      right: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: c.warning,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: BorderRadius.full,
    },
    heroTagText: { fontSize: FontSize.xs, fontWeight: '800', color: '#3a2a02', letterSpacing: 0.2 },
    heroMeta: { position: 'absolute', left: Spacing.md, bottom: Spacing.md, right: Spacing.md },
    heroSpecies: { fontSize: FontSize.lg, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
    heroSub: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.85)', marginTop: 1 },
    sectionLabel: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1.2,
      marginTop: Spacing.xs,
    },
    tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    tile: {
      // Two per row; a lone odd tile stays half-width instead of stretching full-width.
      flexBasis: '48%',
      flexGrow: 0,
      minWidth: 150,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: BorderRadius.md,
      paddingHorizontal: 11,
      paddingVertical: 8,
      gap: 3,
    },
    tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
    tileHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
    tileIcon: { width: 18, height: 18, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    tileLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    tileValue: { fontSize: FontSize.md, fontWeight: '800', color: c.text, letterSpacing: -0.2 },
    starRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },
    tileCount: { fontSize: 11, fontWeight: '700', color: c.textSecondary, flexShrink: 0 },
  });
}
