import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

export function createFishHomeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sectionLabel: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: Spacing.sm,
      marginTop: Spacing.md,
    },
    surfaceCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.lg,
      marginBottom: Spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cardTitle: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
    },
    cardBody: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      marginTop: Spacing.sm,
      lineHeight: 22,
    },
    bulletRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm,
      marginTop: Spacing.xs,
    },
    bulletDot: {
      fontSize: FontSize.md,
      color: colors.primary,
      marginTop: 2,
      width: 12,
    },
    bulletText: {
      flex: 1,
      fontSize: FontSize.md,
      color: colors.text,
      lineHeight: 22,
    },
    aiBubbleLike: {
      alignSelf: 'stretch',
      maxWidth: '100%',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    ctaButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      marginTop: Spacing.sm,
    },
    ctaButtonText: {
      color: colors.textInverse,
      fontSize: FontSize.md,
      fontWeight: '700',
      textAlign: 'center',
    },
    secondaryLink: {
      marginTop: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    secondaryLinkText: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.primary,
    },
  });
}

/** Shared with GuideChat welcome / AI bubbles */
export function useFishHomeStyles() {
  const { colors } = useAppTheme();
  return useMemo(() => createFishHomeStyles(colors), [colors]);
}
