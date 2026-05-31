import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { StyleSheet } from 'react-native';

/** Shared timeline row metrics — solo and group (with avatar) use the same typography and rail sizing. */
export function createTripDashboardTimelineStyles(colors: ThemeColors) {
  return StyleSheet.create({
    timelineItem: {
      flexDirection: 'row',
      gap: Spacing.sm,
      paddingVertical: Spacing.sm,
      alignItems: 'flex-start',
    },
    timelineTime: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      width: 58,
      paddingTop: 12,
      lineHeight: 16,
    },
    timelineTimeInMetaCol: {
      width: '100%',
      paddingTop: 0,
      textAlign: 'center',
    },
    timelineTimeCompact: {
      paddingTop: 0,
      alignSelf: 'center',
    },
    timelineMetaCol: {
      width: 58,
      alignItems: 'center',
      gap: 4,
      paddingTop: 2,
    },
    timelineAvatar: {
      width: 28,
      height: 28,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.borderLight,
      overflow: 'hidden',
    },
    timelineAvatarPlaceholder: {
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    timelineAvatarLetter: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textInverse,
    },
    timelineRail: {
      width: 44,
      alignItems: 'center',
      alignSelf: 'stretch',
      justifyContent: 'flex-start',
      position: 'relative',
    },
    timelineLineAbove: {
      position: 'absolute',
      top: -(Spacing.sm * 2),
      width: 2,
      height: Spacing.sm * 2,
      backgroundColor: colors.border,
      borderRadius: 1,
    },
    timelineLineSegment: {
      width: 2,
      backgroundColor: colors.border,
      borderRadius: 1,
    },
    timelineLineSegmentLower: {
      flexGrow: 1,
      flexShrink: 1,
      minHeight: Spacing.xs,
    },
    timelineNode: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: 2,
      borderColor: colors.border,
      flexShrink: 0,
      marginVertical: 2,
    },
    timelineNodeFly: {
      backgroundColor: colors.background,
      borderColor: colors.secondary,
      overflow: 'hidden',
    },
    timelineNodeBite: {
      backgroundColor: `${colors.success}18`,
      borderColor: `${colors.success}55`,
    },
    timelineNodeCatch: {
      backgroundColor: `${colors.primaryLight}22`,
      borderColor: `${colors.primaryLight}66`,
    },
    timelineNodeCatchPhoto: {
      overflow: 'hidden',
      padding: 0,
      backgroundColor: colors.surface,
    },
    timelineNodeCatchImage: {
      width: 40,
      height: 40,
      borderRadius: 20,
    },
    timelineNodeNote: {
      backgroundColor: `${colors.info}18`,
      borderColor: `${colors.info}55`,
    },
    timelineNodeFlyImage: {
      width: 34,
      height: 34,
      borderRadius: 17,
    },
    timelineBody: {
      flex: 1,
      minWidth: 0,
      paddingTop: 4,
      gap: 2,
    },
    timelineBodyWithAttribution: {
      paddingTop: 2,
    },
    timelineBodyCompact: {
      paddingTop: 0,
      alignSelf: 'center',
    },
    timelineAttribution: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.text,
      lineHeight: 16,
    },
    timelineRowTitle: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.text,
      lineHeight: 20,
    },
    timelineRowSubtitle: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    timelineRowExpandBtn: {
      padding: Spacing.xs,
      paddingTop: 6,
    },
    timelineRowExpandBtnCompact: {
      paddingTop: Spacing.xs,
      alignSelf: 'center',
    },
    timelineRowMenuBtn: {
      padding: Spacing.xs,
      paddingTop: 6,
    },
    timelineRowMenuBtnCompact: {
      paddingTop: Spacing.xs,
      alignSelf: 'center',
    },
    timelineSyncCol: {
      paddingTop: 14,
      width: 14,
      alignItems: 'center',
    },
    timelineSyncDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    timelineCatchDetails: {
      marginTop: Spacing.xs,
      gap: 2,
    },
    timelineCatchDetailLine: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      lineHeight: 18,
    },
  });
}

export function createTripDashboardTimelineTitleStyles(colors: ThemeColors) {
  return StyleSheet.create({
    timelineTitle: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginTop: Spacing.sm,
      marginBottom: Spacing.md,
    },
    timelineScroll: {
      flex: 1,
      paddingHorizontal: Spacing.lg,
      marginTop: Spacing.sm,
    },
    timelineScrollContent: {
      paddingBottom: Spacing.lg,
    },
  });
}
