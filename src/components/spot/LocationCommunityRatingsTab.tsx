import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { formatTripDate } from '@/src/utils/formatters';
import type { LocationPublicTripRatingRow } from '@/src/services/locationCommunityRatings';
import { CLARITY_LABELS } from '@/src/services/waterFlow';
import type { WaterClarity } from '@/src/types';

type Props = {
  colors: ThemeColors;
  loading: boolean;
  rows: LocationPublicTripRatingRow[];
};

function clarityDisplay(value: string | null): string | null {
  if (!value || value === 'unknown') return null;
  if (value in CLARITY_LABELS) return CLARITY_LABELS[value as WaterClarity];
  return value.replace(/_/g, ' ');
}

export function LocationCommunityRatingsTab({ colors, loading, rows }: Props) {
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingHint}>Loading community ratings…</Text>
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No public ratings to show yet.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      {rows.map((row) => {
        const clarityLabel = clarityDisplay(row.user_reported_clarity);
        const dateLabel = row.start_time ? formatTripDate(row.start_time) : formatTripDate(row.rated_at);
        return (
          <View key={row.trip_id} style={styles.card}>
            <View style={styles.cardTop}>
              {row.avatar_url ? (
                <Image source={{ uri: row.avatar_url }} style={styles.avatarLarge} contentFit="cover" />
              ) : (
                <View style={[styles.avatarLarge, styles.avatarPlaceholder]}>
                  <Ionicons name="person" size={28} color={colors.textTertiary} />
                </View>
              )}
              <View style={styles.cardMain}>
                <View style={styles.nameDateRow}>
                  <Text style={styles.displayName} numberOfLines={1}>
                    {row.display_name}
                  </Text>
                  <Text style={styles.dateTopRight} numberOfLines={1}>
                    {dateLabel}
                  </Text>
                </View>
                <View style={styles.fishWaterRow}>
                  <Text style={styles.metaLine}>{row.total_fish} fish</Text>
                  {clarityLabel ? (
                    <Text style={styles.waterRight} numberOfLines={2}>
                      Water: {clarityLabel}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.starsRow}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Ionicons
                      key={i}
                      name={i < row.rating ? 'star' : 'star-outline'}
                      size={18}
                      color={i < row.rating ? colors.warning : colors.textTertiary}
                    />
                  ))}
                </View>
              </View>
            </View>
            {row.notes && row.notes.trim() ? (
              <Text style={styles.noteText}>{row.notes.trim()}</Text>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scroll: { flex: 1 },
    scrollContent: {
      padding: Spacing.md,
      paddingBottom: Spacing.xxl,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.lg,
    },
    loadingHint: {
      marginTop: Spacing.md,
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    emptyText: {
      fontSize: FontSize.md,
      color: colors.textTertiary,
      textAlign: 'center',
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    cardTop: {
      flexDirection: 'row',
      gap: Spacing.md,
      alignItems: 'flex-start',
    },
    avatarLarge: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.background,
    },
    avatarPlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardMain: {
      flex: 1,
      minWidth: 0,
    },
    nameDateRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    displayName: {
      flex: 1,
      minWidth: 0,
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.text,
    },
    dateTopRight: {
      flexShrink: 0,
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      textAlign: 'right',
      marginTop: 2,
    },
    fishWaterRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: Spacing.sm,
      marginTop: 2,
    },
    metaLine: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      flexShrink: 0,
    },
    waterRight: {
      flex: 1,
      minWidth: 0,
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      textAlign: 'right',
    },
    starsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      marginTop: Spacing.sm,
    },
    noteText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: Spacing.md,
      lineHeight: 20,
    },
  });
}
