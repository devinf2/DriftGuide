import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { MaterialIcons } from '@expo/vector-icons';
import {
  LAND_OWNERSHIP_FILL_COLORS,
  LAND_OWNERSHIP_LABELS,
  landAccessMessage,
  type LandAccessTone,
} from '@/src/constants/landOwnership';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { LandOwnershipInfo } from '@/src/types';

export interface LandOwnershipSheetProps {
  /** Ownership at the tapped point, or null to close the sheet. */
  info: LandOwnershipInfo | null;
  /** True between tap and result so we can show a loading state. */
  loading?: boolean;
  onClose: () => void;
}

const TONE_ACCENT: Record<LandAccessTone, { fg: string; bg: string; icon: keyof typeof MaterialIcons.glyphMap }> = {
  public: { fg: '#1B7F3B', bg: 'rgba(27,127,59,0.12)', icon: 'check-circle' },
  restricted: { fg: '#B45309', bg: 'rgba(180,83,9,0.12)', icon: 'warning' },
  unknown: { fg: '#6B7280', bg: 'rgba(107,114,128,0.12)', icon: 'help' },
};

/**
 * Bottom sheet shown when the user taps the map with the Public/Private Land overlay on.
 * Controlled by {@link LandOwnershipSheetProps.info}; uses a non-modal BottomSheet so it needs
 * no provider beyond the app-root GestureHandlerRootView.
 */
export function LandOwnershipSheet({ info, loading, onClose }: LandOwnershipSheetProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['33%'], []);

  const open = info != null || loading === true;

  useEffect(() => {
    if (open) sheetRef.current?.expand();
    else sheetRef.current?.close();
  }, [open]);

  const handleChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const access = info ? landAccessMessage(info) : null;
  const tone = access ? TONE_ACCENT[access.tone] : TONE_ACCENT.unknown;

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onChange={handleChange}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
    >
      <BottomSheetView style={styles.content}>
        {loading && !info ? (
          <Text style={styles.loadingText}>Looking up land ownership…</Text>
        ) : info ? (
          <>
            <View style={styles.headerRow}>
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: LAND_OWNERSHIP_FILL_COLORS[info.ownership_type] },
                ]}
              />
              <Text style={styles.title}>{LAND_OWNERSHIP_LABELS[info.ownership_type]}</Text>
            </View>

            {info.agency ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Managing agency</Text>
                <Text style={styles.metaValue}>{info.agency}</Text>
              </View>
            ) : null}
            {info.owner_name && info.owner_name !== info.agency ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Owner</Text>
                <Text style={styles.metaValue}>{info.owner_name}</Text>
              </View>
            ) : null}
            {info.admin_unit && info.admin_unit !== info.agency ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Unit</Text>
                <Text style={styles.metaValue}>{info.admin_unit}</Text>
              </View>
            ) : null}

            {access ? (
              <View style={[styles.accessBanner, { backgroundColor: tone.bg }]}>
                <MaterialIcons name={tone.icon} size={20} color={tone.fg} />
                <View style={styles.accessTextWrap}>
                  <Text style={[styles.accessTitle, { color: tone.fg }]}>{access.title}</Text>
                  <Text style={styles.accessBody}>{access.body}</Text>
                </View>
              </View>
            ) : null}

            <Text style={styles.attribution}>Data: Utah UGRC Land Ownership</Text>
          </>
        ) : null}
      </BottomSheetView>
    </BottomSheet>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sheetBg: {
      backgroundColor: colors.surface,
    },
    handle: {
      backgroundColor: colors.border,
      width: 40,
    },
    content: {
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.xl,
      gap: Spacing.sm,
    },
    loadingText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      paddingVertical: Spacing.lg,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    swatch: {
      width: 18,
      height: 18,
      borderRadius: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    title: {
      flex: 1,
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
    },
    metaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: Spacing.md,
    },
    metaLabel: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
    },
    metaValue: {
      flex: 1,
      fontSize: FontSize.sm,
      color: colors.text,
      fontWeight: '600',
      textAlign: 'right',
    },
    accessBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: BorderRadius.md,
      marginTop: Spacing.xs,
    },
    accessTextWrap: {
      flex: 1,
      gap: 2,
    },
    accessTitle: {
      fontSize: FontSize.md,
      fontWeight: '700',
    },
    accessBody: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    attribution: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: Spacing.xs,
    },
  });
}
