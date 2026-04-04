import type { GuideLocationRecommendation } from '@/src/services/guideIntelContract';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { confidenceToGuideStars } from '@/src/components/DriftGuideStarsRow';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    panel: {
      marginTop: Spacing.md,
      padding: Spacing.md,
      borderRadius: BorderRadius.lg,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: Spacing.md,
    },
    sectionLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    summary: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.text,
      lineHeight: 22,
      marginTop: -Spacing.xs,
    },
    cardsStack: {
      gap: Spacing.md,
    },
    card: {
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surface,
      padding: Spacing.md,
      gap: Spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderLight,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: Spacing.md,
    },
    nameBtn: {
      flex: 1,
      minWidth: 0,
    },
    nameText: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.primary,
      textDecorationLine: 'underline',
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
    reason: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    fliesLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: Spacing.xs,
    },
    fliesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 6,
    },
    flyChip: {
      backgroundColor: colors.surfaceElevated,
      paddingVertical: 6,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    flyChipText: {
      fontSize: FontSize.xs,
      fontWeight: '500',
      color: colors.text,
    },
  });
}

export function GuideLocationRecommendationCards({
  recommendation,
  colors,
}: {
  recommendation: GuideLocationRecommendation;
  colors: ThemeColors;
}) {
  const router = useRouter();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.panel}>
      <View>
        <Text style={styles.sectionLabel}>Recommendations</Text>
        {recommendation.summary ? (
          <Text style={styles.summary}>{recommendation.summary}</Text>
        ) : null}
      </View>

      <View style={styles.cardsStack}>
        {recommendation.locations.map((loc) => {
          const starValue = confidenceToGuideStars(loc.confidence);
          return (
            <View key={loc.location_id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Pressable
                  style={styles.nameBtn}
                  onPress={() => router.push(`/spot/${loc.location_id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${loc.name}`}
                >
                  <Text style={styles.nameText} numberOfLines={2}>
                    {loc.name}
                  </Text>
                </Pressable>
                <View style={styles.ratingColumn}>
                  <View
                    style={styles.ratingBlock}
                    accessibilityRole="text"
                    accessibilityLabel={`Rating ${starValue.toFixed(1)} out of 5`}
                  >
                    <Ionicons name="star" size={14} color={colors.warning} />
                    <Text style={styles.ratingNum}>{starValue.toFixed(1)}</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.reason}>{loc.reason}</Text>
              {loc.top_flies.length > 0 ? (
                <>
                  <Text style={styles.fliesLabel}>Top flies</Text>
                  <View style={styles.fliesRow}>
                    {loc.top_flies.map((f) => (
                      <View key={f} style={styles.flyChip}>
                        <Text style={styles.flyChipText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
