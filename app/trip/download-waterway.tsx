import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { useLocationStore } from '@/src/stores/locationStore';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { downloadWaterway } from '@/src/services/waterwayCache';
import type { Location } from '@/src/types';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function DownloadWaterwayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isConnected } = useNetworkStatus();
  const { locations, fetchLocations, getChildLocations } = useLocationStore();
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (isConnected) {
      fetchLocations().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [isConnected, fetchLocations]);

  const topLevelLocations = locations.filter((l) => !l.parent_location_id);

  const handleDownload = async (loc: Location) => {
    if (!isConnected) {
      Alert.alert('Offline', 'Connect to the internet to download a waterway.');
      return;
    }
    setDownloadingId(loc.id);
    try {
      const children = getChildLocations(loc.id);
      const allLocations = [loc, ...children];
      await downloadWaterway(loc.id, allLocations);
      Alert.alert('Downloaded', `"${loc.name}" is now available offline.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert('Download failed', (e as Error).message);
    } finally {
      setDownloadingId(null);
    }
  };

  if (!isConnected) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + Spacing.xl }]}>
        <Text style={styles.offlineMessage}>Connect to the internet to add waterways for offline use.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.lg }]}
    >
      <Text style={styles.title}>Download for offline</Text>
      <Text style={styles.subtitle}>Choose a waterway. Conditions will be cached and refreshed when you're back online.</Text>
      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.xxl }} />
      ) : topLevelLocations.length === 0 ? (
        <Text style={styles.empty}>No locations loaded. Pull to refresh on the home screen, then try again.</Text>
      ) : (
        <View style={styles.list}>
          {topLevelLocations.map((loc) => (
            <Pressable
              key={loc.id}
              style={styles.row}
              onPress={() => handleDownload(loc)}
              disabled={downloadingId !== null}
            >
              <MaterialCommunityIcons name="water" size={22} color={Colors.primary} />
              <Text style={styles.rowName}>{loc.name}</Text>
              {downloadingId === loc.id ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <MaterialCommunityIcons name="download" size={22} color={Colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, paddingBottom: Spacing.xxl },
  title: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.xs },
  subtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.xl },
  offlineMessage: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', padding: Spacing.xl },
  empty: { fontSize: FontSize.sm, color: Colors.textTertiary, textAlign: 'center', paddingVertical: Spacing.xl },
  list: { gap: Spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
  },
  rowName: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
});
