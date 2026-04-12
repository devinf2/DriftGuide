import { DriftGuideReferenceCard } from '@/src/components/DriftGuideReferenceCard';
import { OfflineGuideInfoModal } from '@/src/components/OfflineGuideInfoModal';
import { OfflineGuideTile } from '@/src/components/OfflineGuideTile';
import { SpotTaggedText } from '@/src/components/SpotTaggedText';
import { OFFLINE_FISHING_GUIDE_SUPPLEMENT } from '@/src/content/offlineFishingGuideLongForm';
import { FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import type { OfflineGuideSections } from '@/src/services/ai';
import { stripOfflineGuideMarkdown } from '@/src/utils/stripOfflineGuideMarkdown';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

type SheetKind = 'setup' | 'times' | 'flies' | null;

export type OfflineGuideActionStackProps = {
  colors: ThemeColors;
  sections: OfflineGuideSections | null;
  loading: boolean;
  /** Strategy cards (best time / top flies / how to fish) shown inside the “Best flies” sheet. */
  fliesStrategyContent: ReactNode | null;
  strategyLoading?: boolean;
};

export function OfflineGuideActionStack({
  colors,
  sections,
  loading,
  fliesStrategyContent,
  strategyLoading,
}: OfflineGuideActionStackProps) {
  const [sheet, setSheet] = useState<SheetKind>(null);
  const styles = useMemo(() => createStyles(colors), [colors]);

  const supplement = sections?.supplementText?.trim() || OFFLINE_FISHING_GUIDE_SUPPLEMENT;

  const setupPreview = previewFrom(sections?.currentSetup);
  const timesPreview = previewFrom(sections?.bestTimes);
  const fliesPreview = previewFrom(sections?.fliesHowExtras);

  return (
    <>
      <View style={styles.stack} pointerEvents="box-none">
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Loading cached guide…</Text>
          </View>
        ) : null}
        <OfflineGuideTile
          title="Current setup"
          subtitle={setupPreview || 'Rig, water, and saved-area notes'}
          onPress={() => setSheet('setup')}
          colors={colors}
          style={styles.tileGap}
        />
        <OfflineGuideTile
          title="Best times to fish"
          subtitle={timesPreview || 'Saved-log timing and cached weather'}
          onPress={() => setSheet('times')}
          colors={colors}
          style={styles.tileGap}
        />
        <OfflineGuideTile
          title="Best flies & how to fish"
          subtitle={fliesPreview || 'Patterns and techniques for this water'}
          onPress={() => setSheet('flies')}
          colors={colors}
          style={styles.tileGap}
        />
        <View style={styles.tileGap}>
          <DriftGuideReferenceCard rawText={supplement} colors={colors} />
        </View>
      </View>

      <OfflineGuideInfoModal
        visible={sheet === 'setup'}
        title="Current setup"
        subtitle="From your trip and offline bundle"
        onClose={() => setSheet(null)}
        colors={colors}
      >
        {sections?.currentSetup?.trim() ? (
          <SpotTaggedText text={stripOfflineGuideMarkdown(sections.currentSetup)} baseStyle={styles.body} />
        ) : (
          <Text style={styles.muted}>No setup summary cached yet.</Text>
        )}
      </OfflineGuideInfoModal>

      <OfflineGuideInfoModal
        visible={sheet === 'times'}
        title="Best times to fish"
        subtitle="Timing from saved logs and device weather"
        onClose={() => setSheet(null)}
        colors={colors}
      >
        {sections?.bestTimes?.trim() ? (
          <SpotTaggedText text={stripOfflineGuideMarkdown(sections.bestTimes)} baseStyle={styles.body} />
        ) : (
          <Text style={styles.muted}>No timing or weather snapshot on device.</Text>
        )}
      </OfflineGuideInfoModal>

      <OfflineGuideInfoModal
        visible={sheet === 'flies'}
        title="Best flies & how to fish"
        subtitle="Strategy for this water plus log-based picks"
        onClose={() => setSheet(null)}
        colors={colors}
      >
        {strategyLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={styles.flySpinner} />
        ) : (
          fliesStrategyContent
        )}
        {sections?.fliesHowExtras?.trim() ? (
          <View style={styles.flyExtras}>
            <Text style={styles.sectionLabel}>From your offline catch bundle</Text>
            <SpotTaggedText text={stripOfflineGuideMarkdown(sections.fliesHowExtras)} baseStyle={styles.body} />
          </View>
        ) : null}
      </OfflineGuideInfoModal>
    </>
  );
}

function previewFrom(s: string | undefined | null, max = 72): string {
  if (!s?.trim()) return '';
  const one = stripOfflineGuideMarkdown(s).replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    /** Inline at end of scroll — below strategy + chat so nothing is covered. */
    stack: {
      width: '100%',
      alignSelf: 'stretch',
      marginTop: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    tileGap: {
      marginBottom: Spacing.sm,
    },
    loadingBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
      paddingVertical: Spacing.sm,
    },
    loadingText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    body: {
      fontSize: FontSize.md,
      lineHeight: 24,
      color: colors.text,
    },
    muted: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      lineHeight: 22,
    },
    flySpinner: {
      marginVertical: Spacing.md,
    },
    flyExtras: {
      marginTop: Spacing.lg,
      paddingTop: Spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    sectionLabel: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: Spacing.sm,
    },
  });
}
