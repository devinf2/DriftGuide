import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { NearbyLocationResult } from '@/src/types';
import { haversineDistance } from '@/src/services/locationService';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

function formatProximityKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      maxHeight: '88%',
      paddingBottom: Spacing.xl,
    },
    title: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.sm,
    },
    subtitle: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      paddingHorizontal: Spacing.lg,
      marginBottom: Spacing.md,
      lineHeight: 20,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
      marginHorizontal: Spacing.md,
      marginBottom: Spacing.sm,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowText: { flex: 1, minWidth: 0 },
    rowName: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    rowMeta: { fontSize: FontSize.xs, color: colors.textTertiary, marginTop: 2 },
    loading: { padding: Spacing.xxl, alignItems: 'center' },
    empty: {
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.lg,
      color: colors.textSecondary,
      fontSize: FontSize.sm,
    },
    cancelBtn: {
      marginTop: Spacing.sm,
      marginHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cancelText: { fontSize: FontSize.md, fontWeight: '600', color: colors.textSecondary },
  });
}

/** Avoid the opening tap “falling through” and activating the first list row. */
const CANDIDATE_PRESS_ENABLE_DELAY_MS = 320;

type Props = {
  visible: boolean;
  onClose: () => void;
  candidates: NearbyLocationResult[];
  loading: boolean;
  anchorLat: number | null;
  anchorLng: number | null;
  onPick: (c: NearbyLocationResult) => void;
};

export function NearbyRootLocationPickerModal({
  visible,
  onClose,
  candidates,
  loading,
  anchorLat,
  anchorLng,
  onPick,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [candidateRowsEnabled, setCandidateRowsEnabled] = useState(false);

  useEffect(() => {
    if (!visible) {
      setCandidateRowsEnabled(false);
      return;
    }
    if (loading || candidates.length === 0) {
      setCandidateRowsEnabled(false);
      return;
    }
    setCandidateRowsEnabled(false);
    const t = setTimeout(() => setCandidateRowsEnabled(true), CANDIDATE_PRESS_ENABLE_DELAY_MS);
    return () => clearTimeout(t);
  }, [visible, loading, candidates.length]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Choose location</Text>
          <Text style={styles.subtitle}>
            Nearest saved waters to your photo location. Pick the one that matches this trip.
          </Text>
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {candidates.length === 0 ? (
                <Text style={styles.empty}>
                  No nearby locations found. Try adding a location from the map, or move photos with GPS into
                  this group.
                </Text>
              ) : (
                candidates.map((c) => {
                  const dKm =
                    anchorLat != null && anchorLng != null
                      ? haversineDistance(anchorLat, anchorLng, c.latitude, c.longitude)
                      : c.distance_km;
                  return (
                    <Pressable
                      key={c.id}
                      style={styles.row}
                      disabled={!candidateRowsEnabled}
                      onPress={() => onPick(c)}
                    >
                      <View style={styles.rowText}>
                        <Text style={styles.rowName} numberOfLines={2}>
                          {c.name}
                        </Text>
                        <Text style={styles.rowMeta}>{formatProximityKm(dKm)}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                    </Pressable>
                  );
                })
              )}
              <Pressable style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
