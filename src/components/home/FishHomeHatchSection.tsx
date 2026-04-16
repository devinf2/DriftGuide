import { DriftGuideMessage } from '@/src/components/home/DriftGuideMessage';
import type { HatchBriefRow } from '@/src/services/ai';
import { getHatchModalDetailCopy } from '@/src/utils/hatchModalEnrichment';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

function hatchDotColor(tier: HatchBriefRow['tier'], colors: ThemeColors): string {
  if (tier === 'active') return colors.secondary;
  if (tier === 'starting') return colors.warning;
  if (tier === 'waning') return colors.textTertiary;
  return colors.textSecondary;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
    },
    bugIcon: {
      marginRight: 2,
    },
    headerTitle: {
      flex: 1,
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.warning,
      fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: undefined }),
    },
    body: {
      paddingHorizontal: Spacing.sm,
      paddingBottom: Spacing.xs,
    },
    hatchList: {
      gap: Spacing.sm,
    },
    emptyText: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      lineHeight: 18,
      paddingHorizontal: Spacing.sm,
      paddingTop: Spacing.xs,
    },
    hatchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceElevated,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: Spacing.sm,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      flexShrink: 0,
    },
    hatchRowText: {
      flex: 1,
      minWidth: 0,
    },
    insectName: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.text,
    },
    sizeHint: {
      fontSize: FontSize.xs,
      fontWeight: '400',
      color: colors.textTertiary,
    },
    statusLabel: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      flexShrink: 0,
      marginLeft: Spacing.xs,
    },
    rowChevron: {
      flexShrink: 0,
    },
    seeMoreRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      marginTop: Spacing.xs,
      paddingVertical: 2,
      paddingHorizontal: Spacing.xs,
    },
    seeMoreText: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.secondary,
    },
    referenceFootnoteRow: {
      marginTop: Spacing.sm,
      paddingHorizontal: Spacing.sm,
      paddingBottom: Spacing.sm,
      alignSelf: 'flex-start',
    },
    referenceFootnote: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.secondary,
      textDecorationLine: 'underline',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    modalAlign: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      paddingHorizontal: Spacing.md,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      maxHeight: 440,
      overflow: 'hidden',
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modalTitle: {
      flex: 1,
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    modalClose: {
      padding: Spacing.xs,
      marginTop: -Spacing.xs,
      marginRight: -Spacing.xs,
    },
    modalScroll: {
      maxHeight: 420,
    },
    modalScrollContent: {
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
    },
    modalMeta: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      marginBottom: Spacing.xs,
    },
    modalMetaStrong: {
      fontWeight: '600',
      color: colors.text,
    },
    modalDetail: {
      fontSize: FontSize.sm,
      color: colors.text,
      lineHeight: 22,
      marginBottom: Spacing.sm,
    },
    modalDisclaimer: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      lineHeight: 18,
      marginBottom: Spacing.sm,
    },
    modalLink: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.secondary,
      textDecorationLine: 'underline',
    },
  });
}

const HATCH_PREVIEW = 2;
const HATCH_EXPANDED_MAX = 4;

export function FishHomeHatchSection({
  loading,
  rows,
}: {
  loading: boolean;
  rows?: HatchBriefRow[] | null;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(true);
  const [showMoreHatches, setShowMoreHatches] = useState(false);
  const [selectedHatch, setSelectedHatch] = useState<HatchBriefRow | null>(null);
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const safeRows = Array.isArray(rows) ? rows : [];
  const visibleRows = showMoreHatches
    ? safeRows.slice(0, HATCH_EXPANDED_MAX)
    : safeRows.slice(0, HATCH_PREVIEW);
  const hasMoreToShow = safeRows.length > HATCH_PREVIEW;
  const moreCount = Math.min(HATCH_EXPANDED_MAX - HATCH_PREVIEW, safeRows.length - HATCH_PREVIEW);

  const openInAppHatchCalendar = () => {
    setSelectedHatch(null);
    router.push('/home/hatch-chart');
  };

  const modalCopy = selectedHatch ? getHatchModalDetailCopy(selectedHatch) : null;

  return (
    <DriftGuideMessage>
      <View style={styles.card}>
        <Pressable
          style={styles.headerRow}
          onPress={() => {
            setExpanded((e) => {
              if (e) setShowMoreHatches(false);
              return !e;
            });
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel="Hatch information"
        >
          <MaterialCommunityIcons name="bug" size={18} color={colors.warning} style={styles.bugIcon} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            Hatch Information
          </Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
        </Pressable>

        {expanded ? (
          <View style={styles.body}>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: Spacing.sm }} />
            ) : safeRows.length === 0 ? (
              <Text style={styles.emptyText}>
                Add waters in DriftGuide to see hatch notes tied to current conditions near you.
              </Text>
            ) : (
              <>
                <View style={styles.hatchList}>
                  {visibleRows.map((row, i) => (
                    <Pressable
                      key={`${row.insect}-${i}`}
                      style={styles.hatchRow}
                      onPress={() => setSelectedHatch(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`Hatch details for ${row.insect}`}
                    >
                      <View style={[styles.statusDot, { backgroundColor: hatchDotColor(row.tier, colors) }]} />
                      <View style={styles.hatchRowText}>
                        <Text style={styles.insectName} numberOfLines={1}>
                          {row.insect}
                          {row.sizes ? (
                            <Text style={styles.sizeHint}>
                              {' '}
                              ({row.sizes})
                            </Text>
                          ) : null}
                        </Text>
                      </View>
                      <Text style={styles.statusLabel} numberOfLines={1}>
                        {row.status}
                      </Text>
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={colors.textTertiary}
                        style={styles.rowChevron}
                      />
                    </Pressable>
                  ))}
                </View>
                {hasMoreToShow && !showMoreHatches ? (
                  <Pressable
                    style={styles.seeMoreRow}
                    onPress={() => setShowMoreHatches(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${moreCount} more hatches`}
                  >
                    <Text style={styles.seeMoreText}>
                      {moreCount === 1 ? 'Show 1 more' : `Show ${moreCount} more`}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={colors.secondary} />
                  </Pressable>
                ) : null}
                {hasMoreToShow && showMoreHatches ? (
                  <Pressable
                    style={styles.seeMoreRow}
                    onPress={() => setShowMoreHatches(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Show fewer hatches"
                  >
                    <Text style={styles.seeMoreText}>Show fewer</Text>
                    <Ionicons name="chevron-up" size={16} color={colors.secondary} />
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.referenceFootnoteRow}
                  onPress={openInAppHatchCalendar}
                  accessibilityRole="button"
                  accessibilityLabel="Open DriftGuide hatch calendar"
                >
                  <Text style={styles.referenceFootnote}>DriftGuide hatch calendar</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
      </View>

      <Modal
        visible={selectedHatch != null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedHatch(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedHatch(null)} />
          <View style={styles.modalAlign} pointerEvents="box-none">
            {selectedHatch ? (
              <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle} numberOfLines={3}>
                    {selectedHatch.insect}
                  </Text>
                  <Pressable
                    onPress={() => setSelectedHatch(null)}
                    hitSlop={12}
                    style={styles.modalClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close hatch details"
                  >
                    <Ionicons name="close" size={26} color={colors.text} />
                  </Pressable>
                </View>
                <ScrollView
                  style={styles.modalScroll}
                  contentContainerStyle={styles.modalScrollContent}
                  keyboardShouldPersistTaps="handled"
                >
                  <Text style={styles.modalMeta}>
                    <Text style={styles.modalMetaStrong}>Sizes:</Text> {selectedHatch.sizes || '—'}
                  </Text>
                  <Text style={[styles.modalMeta, { marginBottom: Spacing.sm }]}>
                    <Text style={styles.modalMetaStrong}>Status:</Text> {selectedHatch.status || '—'}
                  </Text>
                  {modalCopy ? <Text style={styles.modalDetail}>{modalCopy.text}</Text> : null}
                  <Text style={styles.modalDisclaimer}>Regional guidance only—not what is on the water today.</Text>
                  <Pressable
                    onPress={openInAppHatchCalendar}
                    accessibilityRole="button"
                    accessibilityLabel="Open DriftGuide hatch calendar"
                  >
                    <Text style={styles.modalLink}>View DriftGuide hatch calendar</Text>
                  </Pressable>
                </ScrollView>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </DriftGuideMessage>
  );
}
