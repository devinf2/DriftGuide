import { BorderRadius, FontSize, LocationTypeColors, Spacing, type ThemeColors } from '@/src/constants/theme';
import type { LocationType, Photo, Trip } from '@/src/types';
import { formatFishCount, formatTripDate, formatTripDuration } from '@/src/utils/formatters';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { memo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

/** Unique image URLs for a trip from `photos` rows (includes catch-linked via catch_id). */
export function imageUrlsForTrip(tripId: string, photos: Photo[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (u: string | null | undefined) => {
    const t = u?.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    urls.push(t);
  };

  const tripPhotos = photos.filter((p) => p.trip_id === tripId);
  tripPhotos.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  for (const p of tripPhotos) add(p.url);

  return urls;
}

export function JournalTripCarousel({
  urls,
  width,
  height,
  colors,
  styles,
  onImagePress,
}: {
  urls: string[];
  width: number;
  height: number;
  colors: ThemeColors;
  styles: ReturnType<typeof createJournalTripGridStyles>;
  /** When set, tapping a photo or the empty “No photos” area opens the trip (same as the card body). */
  onImagePress?: (() => void) | null;
}) {
  const [index, setIndex] = useState(0);

  if (urls.length === 0) {
    const empty = (
      <View style={[styles.tripCarouselEmpty, { width, height }]}>
        <MaterialIcons name="photo-library" size={28} color={colors.textTertiary} />
        <Text style={styles.tripCarouselEmptyText}>No photos</Text>
      </View>
    );
    if (onImagePress) {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open trip"
          onPress={onImagePress}
          style={({ pressed }) => [
            { width, height },
            pressed && styles.tripCarouselEmptyPressed,
          ]}
        >
          {empty}
        </Pressable>
      );
    }
    return empty;
  }

  return (
    <View style={[styles.tripCarouselWrap, { width, height }]}>
      <ScrollView
        horizontal
        pagingEnabled
        style={{ width, height }}
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        decelerationRate="fast"
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          const page = Math.round(x / Math.max(width, 1));
          setIndex(Math.min(Math.max(page, 0), urls.length - 1));
        }}
      >
        {urls.map((uri, i) =>
          onImagePress ? (
            <Pressable
              key={`${uri}-${i}`}
              accessibilityRole="button"
              accessibilityLabel="Open trip"
              onPress={onImagePress}
              style={{ width, height }}
            >
              <Image source={{ uri }} style={{ width, height }} resizeMode="cover" />
            </Pressable>
          ) : (
            <Image
              key={`${uri}-${i}`}
              source={{ uri }}
              style={{ width, height }}
              resizeMode="cover"
            />
          ),
        )}
      </ScrollView>
      {urls.length > 1 ? (
        <View style={styles.tripCarouselDots} pointerEvents="none">
          {urls.map((_, i) => (
            <View
              key={i}
              style={[styles.tripCarouselDot, i === index && styles.tripCarouselDotActive]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const JournalTripGridCard = memo(function JournalTripGridCard({
  trip,
  imageUrls,
  cardWidth,
  onPress,
  colors,
  styles,
}: {
  trip: Trip;
  imageUrls: string[];
  cardWidth: number;
  onPress: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof createJournalTripGridStyles>;
}) {
  const locationType = trip.location?.type as LocationType | undefined;
  const accent =
    locationType && LocationTypeColors[locationType] ? LocationTypeColors[locationType] : colors.primary;
  const carouselHeight = Math.round(cardWidth * 1.02);

  return (
    <View style={[styles.tripGridCard, { width: cardWidth }]}>
      <JournalTripCarousel
        urls={imageUrls}
        width={cardWidth}
        height={carouselHeight}
        colors={colors}
        styles={styles}
        onImagePress={onPress}
      />
      <Pressable
        style={({ pressed }) => [styles.tripGridBody, pressed && styles.tripGridBodyPressed]}
        onPress={onPress}
      >
        <View style={styles.tripGridLocationRow}>
          <MaterialIcons name="place" size={12} color={accent} style={styles.tripGridPin} />
          <Text style={styles.tripGridLocation} numberOfLines={2}>
            {trip.location?.name || 'Unknown Location'}
          </Text>
        </View>
        <View style={styles.tripGridMeta}>
          <View style={[styles.tripGridPill, { backgroundColor: `${accent}18` }]}>
            <Text style={[styles.tripGridStatAccent, { color: accent }]}>
              {formatFishCount(trip.total_fish)}
            </Text>
          </View>
          {trip.shared_session_id ? (
            <MaterialIcons name="group" size={14} color={colors.textSecondary} style={{ marginRight: 4 }} />
          ) : null}
          <Text style={styles.tripGridDate} numberOfLines={1}>
            {formatTripDate(trip.start_time)}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}, (prev, next) => {
  if (prev.trip.id !== next.trip.id) return false;
  if (prev.trip.total_fish !== next.trip.total_fish) return false;
  if (prev.trip.shared_session_id !== next.trip.shared_session_id) return false;
  if (prev.cardWidth !== next.cardWidth) return false;
  if (prev.imageUrls.length !== next.imageUrls.length) return false;
  for (let i = 0; i < prev.imageUrls.length; i++) {
    if (prev.imageUrls[i] !== next.imageUrls[i]) return false;
  }
  return true;
});

export function createJournalTripGridStyles(colors: ThemeColors) {
  return StyleSheet.create({
    tripGridCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 3,
    },
    tripCarouselWrap: {
      position: 'relative',
      backgroundColor: colors.borderLight,
    },
    tripCarouselEmpty: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.borderLight,
      gap: Spacing.xs,
    },
    tripCarouselEmptyPressed: {
      opacity: 0.75,
    },
    tripCarouselEmptyText: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      fontWeight: '500',
    },
    tripCarouselDots: {
      position: 'absolute',
      bottom: 6,
      left: 0,
      right: 0,
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 4,
    },
    tripCarouselDot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: 'rgba(255,255,255,0.45)',
    },
    tripCarouselDotActive: {
      backgroundColor: colors.textInverse,
      width: 7,
    },
    tripGridBody: {
      paddingHorizontal: 6,
      paddingTop: 6,
      paddingBottom: 6,
    },
    tripGridBodyPressed: {
      opacity: 0.75,
    },
    tripGridLocationRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      minHeight: 0,
    },
    tripGridPin: {
      marginRight: 3,
      marginTop: 1,
    },
    tripGridLocation: {
      flex: 1,
      minWidth: 0,
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
      lineHeight: 15,
    },
    tripGridDate: {
      flex: 1,
      flexShrink: 1,
      fontSize: 10,
      color: colors.textSecondary,
      textAlign: 'right',
      lineHeight: 13,
    },
    tripGridMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
      gap: 6,
    },
    tripGridPill: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: BorderRadius.sm - 2,
    },
    tripGridStatAccent: {
      fontSize: 10,
      fontWeight: '600',
      lineHeight: 13,
    },
  });
}
