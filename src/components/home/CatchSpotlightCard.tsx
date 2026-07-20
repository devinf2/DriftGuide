import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import type { CatchSpotlight } from '@/src/hooks/useRecentCatchesRecap';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { CatchRow } from '@/src/types';
import { formatFlyLabel } from '@/src/utils/getFlyForCatch';
import { formatTripDate } from '@/src/utils/formatters';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  spotlight: CatchSpotlight;
  onOpen: (row: CatchRow) => void;
};

type Pill = { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string };

function heroUrl(row: CatchRow): string | null {
  if (row.photo_url) return row.photo_url;
  if (Array.isArray(row.photo_urls) && row.photo_urls.length > 0) return row.photo_urls[0];
  return null;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      marginHorizontal: Spacing.lg,
      marginBottom: Spacing.lg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      marginBottom: Spacing.sm,
    },
    headerLabel: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    card: {
      borderRadius: BorderRadius.lg,
      overflow: 'hidden',
      backgroundColor: colors.surfaceElevated,
      aspectRatio: 16 / 10,
    },
    image: {
      ...StyleSheet.absoluteFillObject,
      width: '100%',
      height: '100%',
    },
    placeholder: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Floating location chip pinned to the top-left of the photo.
    locationChip: {
      position: 'absolute',
      top: Spacing.sm,
      left: Spacing.sm,
      maxWidth: '80%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(15,23,42,0.55)',
      borderRadius: BorderRadius.full,
      paddingVertical: 5,
      paddingHorizontal: Spacing.sm,
    },
    locationText: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: '#FFFFFF',
      flexShrink: 1,
    },
    // Bottom detail block (no scrim — text legibility comes from shadows).
    bottomOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingTop: Spacing.xl,
      paddingBottom: Spacing.sm,
      paddingHorizontal: Spacing.md,
    },
    title: {
      fontSize: FontSize.xl,
      fontWeight: '800',
      color: '#FFFFFF',
      textShadowColor: 'rgba(0,0,0,0.65)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 6,
    },
    pillRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
      marginTop: Spacing.md,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(15,23,42,0.5)',
      borderRadius: BorderRadius.full,
      paddingVertical: 4,
      paddingHorizontal: Spacing.sm,
    },
    pillText: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: '#FFFFFF',
    },
  });
}

/** Welcome tab's rotating "Catch Spotlight" — one featured catch that changes daily. */
export function CatchSpotlightCard({ spotlight, onOpen }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const row = spotlight.catch;
  const url = heroUrl(row);
  const species = row.species?.trim() || '';
  const size = row.size_inches != null ? `${row.size_inches}"` : null;
  const title = [species, size].filter(Boolean).join(' · ');
  const fly = formatFlyLabel({
    fly_pattern: row.fly_pattern,
    fly_size: row.fly_size,
    fly_color: row.fly_color,
  });

  const pills: Pill[] = [];
  if (fly) pills.push({ icon: 'hook', label: fly });
  pills.push({ icon: 'calendar-blank-outline', label: formatTripDate(row.timestamp) });

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="star-four-points" size={14} color={colors.primary} />
        <Text style={styles.headerLabel}>Catch spotlight</Text>
      </View>

      <Pressable
        style={styles.card}
        onPress={() => onOpen(row)}
        accessibilityRole="button"
        accessibilityLabel={`${spotlight.reason || 'Featured catch'}: ${title || 'catch'}. Opens catch photo.`}
      >
        {url ? (
          url.startsWith('http') ? (
            <OfflineTripPhotoImage
              remoteUri={url}
              maxPixelSize={1000}
              style={styles.image}
              contentFit="cover"
            />
          ) : (
            <Image
              source={{ uri: url }}
              style={styles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={url}
              transition={160}
            />
          )
        ) : (
          <View style={styles.placeholder}>
            <MaterialCommunityIcons name="fish" size={48} color={colors.textTertiary} />
          </View>
        )}

        {spotlight.locationName ? (
          <View style={styles.locationChip}>
            <MaterialCommunityIcons name="map-marker" size={13} color="#FFFFFF" />
            <Text style={styles.locationText} numberOfLines={1}>
              {spotlight.locationName}
            </Text>
          </View>
        ) : null}

        <View style={styles.bottomOverlay}>
          {title ? (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          <View style={styles.pillRow}>
            {pills.map((p) => (
              <View key={p.label} style={styles.pill}>
                <MaterialCommunityIcons name={p.icon} size={13} color="rgba(255,255,255,0.9)" />
                <Text style={styles.pillText}>{p.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </Pressable>
    </View>
  );
}
