import { BorderRadius, Colors, FontSize, Spacing } from '@/src/constants/theme';
import {
  formatOfflineDownloadSummary,
  offlineWaterwayLabel,
} from '@/src/utils/offlineDownloadSummary';
import {
  getDownloadedWaterways,
  refreshWaterway,
  removeDownloadedWaterway,
  type DownloadedWaterway,
} from '@/src/services/waterwayCache';
import { useAuthStore } from '@/src/stores/authStore';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function OfflineMapsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthStore();
  const [downloadedWaterways, setDownloadedWaterways] = useState<DownloadedWaterway[]>([]);
  const [refreshingWaterwayId, setRefreshingWaterwayId] = useState<string | null>(null);
  const [offlineDetailWaterway, setOfflineDetailWaterway] = useState<DownloadedWaterway | null>(null);

  const reloadOffline = useCallback(async () => {
    setDownloadedWaterways(await getDownloadedWaterways());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reloadOffline();
    }, [reloadOffline]),
  );

  const handleRemoveWaterway = (locationId: string) => {
    Alert.alert('Remove', 'Remove this waterway from offline storage?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeDownloadedWaterway(locationId);
          await reloadOffline();
        },
      },
    ]);
  };

  const handleRefreshWaterway = async (locationId: string) => {
    setRefreshingWaterwayId(locationId);
    try {
      await refreshWaterway(locationId, user?.id ?? null);
      await reloadOffline();
    } finally {
      setRefreshingWaterwayId(null);
    }
  };

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
      >
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Offline data</Text>
          <Text style={styles.helpText}>
            Conditions, catches in the downloaded square, trip locations, and the paired Mapbox basemap
            tiles — refreshed when you are online. Remove a region here to delete its map pack too.
          </Text>
          {downloadedWaterways.length === 0 ? (
            <Text style={styles.emptyText}>Nothing downloaded yet</Text>
          ) : (
            downloadedWaterways.map((w) => {
              const name = offlineWaterwayLabel(w);
              const isRefreshing = refreshingWaterwayId === w.locationId;
              return (
                <View key={w.locationId} style={styles.waterwayRow}>
                  <Text style={styles.waterwayName} numberOfLines={1}>
                    {name}
                  </Text>
                  <View style={styles.waterwayActions}>
                    <Pressable
                      style={styles.iconBtn}
                      onPress={() => setOfflineDetailWaterway(w)}
                      accessibilityRole="button"
                      accessibilityLabel="View cached offline data"
                    >
                      <MaterialCommunityIcons name="database-outline" size={22} color={Colors.primary} />
                    </Pressable>
                    <Pressable
                      style={styles.textBtn}
                      onPress={() => handleRefreshWaterway(w.locationId)}
                      disabled={isRefreshing}
                    >
                      {isRefreshing ? (
                        <ActivityIndicator size="small" color={Colors.primary} />
                      ) : (
                        <Text style={styles.textBtnLabel}>Refresh</Text>
                      )}
                    </Pressable>
                    <Pressable style={styles.removeBtn} onPress={() => handleRemoveWaterway(w.locationId)}>
                      <Text style={styles.removeBtnText}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
          <Pressable style={styles.addBtn} onPress={() => router.push('/trip/download-waterway')}>
            <Text style={styles.addBtnText}>
              {downloadedWaterways.length === 0 ? 'Download for offline' : 'Add region'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={offlineDetailWaterway != null}
        transparent
        animationType="fade"
        onRequestClose={() => setOfflineDetailWaterway(null)}
      >
        <View style={styles.detailRoot}>
          <Pressable
            style={styles.detailBackdrop}
            onPress={() => setOfflineDetailWaterway(null)}
            accessibilityLabel="Dismiss"
          />
          <View style={styles.detailForeground} pointerEvents="box-none">
            <View style={styles.detailCard}>
              <Text style={styles.detailTitle}>Cached offline data</Text>
              <Text style={styles.detailSubtitle} numberOfLines={1}>
                {offlineDetailWaterway ? offlineWaterwayLabel(offlineDetailWaterway) : ''}
              </Text>
              <ScrollView
                style={[styles.detailScroll, { maxHeight: Math.min(560, SCREEN_HEIGHT * 0.58) }]}
                contentContainerStyle={styles.detailScrollContent}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                {offlineDetailWaterway ? (
                  <Text style={styles.detailBody} selectable>
                    {formatOfflineDownloadSummary(offlineDetailWaterway)}
                  </Text>
                ) : null}
              </ScrollView>
              <Pressable style={styles.detailClose} onPress={() => setOfflineDetailWaterway(null)}>
                <Text style={styles.detailCloseText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  helpText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  emptyText: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  waterwayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  waterwayName: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  waterwayActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  iconBtn: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBtn: { paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm, minWidth: 56, alignItems: 'center' },
  textBtnLabel: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  removeBtn: { paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm },
  removeBtnText: { fontSize: FontSize.sm, color: Colors.error, fontWeight: '600' },
  addBtn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.background,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  addBtnText: { fontSize: FontSize.md, fontWeight: '600', color: Colors.primary },
  detailRoot: { flex: 1 },
  detailBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  detailForeground: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    padding: Spacing.lg,
    zIndex: 1,
  },
  detailCard: {
    maxHeight: '85%' as const,
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  detailTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  detailSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.xs, marginBottom: Spacing.md },
  detailScroll: {},
  detailScrollContent: { paddingBottom: Spacing.sm },
  detailBody: {
    fontSize: FontSize.sm,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined }),
    color: Colors.text,
    lineHeight: 20,
  },
  detailClose: { marginTop: Spacing.md, paddingVertical: Spacing.sm, alignItems: 'center' },
  detailCloseText: { fontSize: FontSize.md, fontWeight: '600', color: Colors.primary },
});
