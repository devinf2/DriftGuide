import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAuthStore } from '@/src/stores/authStore';
import { useTripStore } from '@/src/stores/tripStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import Constants from 'expo-constants';
import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const appVersion = Constants.expoConfig?.version ?? '1.0.0';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: Spacing.xl },
    sectionSpacing: { marginTop: Spacing.lg },
    card: {
      backgroundColor: colors.surface,
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
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: Spacing.sm,
    },
    bodyText: { fontSize: FontSize.sm, color: colors.textSecondary, lineHeight: 20 },
    version: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      marginTop: Spacing.md,
      textAlign: 'center',
    },
    primaryBtn: {
      marginTop: Spacing.md,
      backgroundColor: colors.primary,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      borderRadius: BorderRadius.sm,
      alignItems: 'center',
    },
    primaryBtnDisabled: { opacity: 0.7 },
    primaryBtnText: { fontSize: FontSize.md, fontWeight: '600', color: colors.textInverse },
    signOutRow: { paddingVertical: Spacing.lg, alignItems: 'center' },
    signOutText: { fontSize: FontSize.md, color: colors.error, fontWeight: '600' },
    appearanceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    appearanceLabelWrap: { flex: 1 },
    appearanceHint: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      marginTop: Spacing.xs,
      lineHeight: 18,
    },
  });
}

export default function ProfileSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors, darkModeEnabled, setDarkModeEnabled } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { signOut } = useAuthStore();
  const { pendingSyncTrips, retryPendingSyncs, isSyncingPending } = useTripStore();

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleRetrySync = useCallback(async () => {
    const prevCount = pendingSyncTrips.length;
    await retryPendingSyncs();
    const newCount = useTripStore.getState().pendingSyncTrips.length;
    if (newCount < prevCount) {
      Alert.alert(
        'Trip synced',
        prevCount - newCount === 1 ? '1 trip synced to the cloud.' : `${prevCount - newCount} trips synced.`,
      );
    } else if (prevCount > 0) {
      Alert.alert('Sync failed', 'Could not sync. Check your connection and try again.');
    }
  }, [pendingSyncTrips.length, retryPendingSyncs]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
    >
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.appearanceRow}>
          <View style={styles.appearanceLabelWrap}>
            <Text style={styles.bodyText}>Dark mode</Text>
            <Text style={styles.appearanceHint}>
              On: dark theme. Off: light theme.
            </Text>
          </View>
          <Switch
            value={darkModeEnabled}
            onValueChange={setDarkModeEnabled}
            trackColor={{ false: colors.border, true: colors.primaryLight }}
            thumbColor={colors.surfaceElevated}
          />
        </View>
      </View>

      {pendingSyncTrips.length > 0 ? (
        <View style={[styles.card, styles.sectionSpacing]}>
          <Text style={styles.sectionTitle}>Offline sync</Text>
          <Text style={styles.bodyText}>
            {pendingSyncTrips.length} trip{pendingSyncTrips.length !== 1 ? 's' : ''} saved on device waiting
            to sync.
          </Text>
          <Pressable
            style={[styles.primaryBtn, isSyncingPending && styles.primaryBtnDisabled]}
            onPress={handleRetrySync}
            disabled={isSyncingPending}
          >
            {isSyncingPending ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.primaryBtnText}>Retry sync</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.card, styles.sectionSpacing]}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.bodyText}>
          DriftGuide helps you plan trips, log catches, and fish smarter with local conditions and your
          journal.
        </Text>
        <Text style={styles.version}>DriftGuide v{appVersion}</Text>
      </View>

      <View style={[styles.card, styles.sectionSpacing]}>
        <Text style={styles.sectionTitle}>Account</Text>
        <Pressable style={styles.signOutRow} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
