/**
 * WS-G — Streak & milestone home card (SELF-CONTAINED).
 *
 * Drop this element into the home screen's `homeMilestoneSlot` — it loads its own
 * data via useStreakMilestoneSummary and renders nothing until there's something
 * worth showing (a streak, a personal best, or a species milestone). Tapping it
 * routes to the stats screen.
 *
 * Integrator wiring (one line in app/(tabs)/home/index.tsx):
 *   import { StreakMilestoneCard } from '@/src/components/home/StreakMilestoneCard';
 *   const homeMilestoneSlot: ReactNode = <StreakMilestoneCard />;
 */
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useStreakMilestoneSummary } from '@/src/hooks/useStreakMilestoneSummary';

export function StreakMilestoneCard() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { summary } = useStreakMilestoneSummary();

  // Build the headline. Priority: at-risk streak > active streak > new milestone
  // > personal best. Render nothing if none apply (keeps the home screen clean).
  const content = useMemo(() => {
    if (!summary) return null;
    const { streak, speciesMilestone, personalBests } = summary;

    if (streak.atRisk && streak.current > 0) {
      return {
        icon: 'fire' as const,
        title: `${streak.current}-week streak at risk`,
        subtitle: 'Fish this week to keep it alive.',
      };
    }
    if (streak.current >= 2) {
      return {
        icon: 'fire' as const,
        title: `${streak.current}-week fishing streak`,
        subtitle:
          streak.longest > streak.current
            ? `Your best is ${streak.longest} weeks.`
            : "That's your best run yet.",
      };
    }
    if (speciesMilestone.crossedThreshold != null) {
      return {
        icon: 'trophy-variant' as const,
        title: `${speciesMilestone.distinctSpecies} species landed`,
        subtitle: `You've passed the ${speciesMilestone.crossedThreshold}-species milestone.`,
      };
    }
    if (personalBests.biggestBySizeInches != null) {
      const sp = personalBests.biggestSpecies ? `${personalBests.biggestSpecies} ` : '';
      return {
        icon: 'fish' as const,
        title: 'Personal best',
        subtitle: `Your biggest ${sp}is ${personalBests.biggestBySizeInches}".`,
      };
    }
    return null;
  }, [summary]);

  if (!content) return null;

  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push('/profile/stats')}
      accessibilityRole="button"
      accessibilityLabel={`${content.title}. ${content.subtitle}`}
    >
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name={content.icon} size={26} color={colors.primary} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {content.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {content.subtitle}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.lg,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
        },
        android: { elevation: 2 },
      }),
    },
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primaryLight,
    },
    textWrap: { flex: 1 },
    title: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    subtitle: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2 },
  });
}
