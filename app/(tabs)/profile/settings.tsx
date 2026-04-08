import { PLAN_TRIP_FAB_MAP_CLEARANCE } from '@/src/components/PlanTripFab';
import { UsStatePickerModal } from '@/src/components/UsStatePickerModal';
import { matchStoredProfileHomeState, type UsStateOption } from '@/src/constants/usStates';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { useTripStore } from '@/src/stores/tripStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { clearTripPhotoOfflineCache } from '@/src/services/tripPhotoOfflineCache';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
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
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      flexWrap: 'wrap',
      marginBottom: Spacing.sm,
      gap: Spacing.xs,
    },
    sectionTitleInRow: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    sectionInfoHit: { padding: Spacing.xs },
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
    deleteAccountRow: { paddingTop: Spacing.md, alignItems: 'center' },
    pickerButton: {
      backgroundColor: colors.background,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
    },
    pickerButtonText: { fontSize: FontSize.md, color: colors.text },
    pickerPlaceholder: { fontSize: FontSize.md, color: colors.textTertiary },
    clearHomeState: {
      alignSelf: 'flex-start',
      marginTop: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    clearHomeStateText: { fontSize: FontSize.sm, color: colors.primary, fontWeight: '600' },
    appearanceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    appearanceLabelWrap: { flex: 1 },
    nameFieldLabel: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: Spacing.xs,
      marginTop: Spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    nameFieldLabelFirst: { marginTop: 0 },
    nameInput: {
      backgroundColor: colors.background,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      fontSize: FontSize.md,
      color: colors.text,
      marginBottom: Spacing.xs,
    },
  });
}

export default function ProfileSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors, darkModeEnabled, setDarkModeEnabled } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { signOut, softDeleteAccount, profile, updateHomeState, updateProfileNames, fetchProfile } =
    useAuthStore();
  const fetchLocations = useLocationStore((s) => s.fetchLocations);
  const { pendingSyncTrips, retryPendingSyncs, isSyncingPending } = useTripStore();
  const [homeStateSelected, setHomeStateSelected] = useState<UsStateOption | null>(null);
  const [stateModalOpen, setStateModalOpen] = useState(false);
  const [savingHomeState, setSavingHomeState] = useState(false);
  const [clearingTripPhotos, setClearingTripPhotos] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [firstNameDraft, setFirstNameDraft] = useState('');
  const [lastNameDraft, setLastNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    setHomeStateSelected(matchStoredProfileHomeState(profile?.home_state));
  }, [profile?.home_state]);

  useEffect(() => {
    setFirstNameDraft(profile?.first_name?.trim() ?? '');
    setLastNameDraft(profile?.last_name?.trim() ?? '');
  }, [profile?.first_name, profile?.last_name]);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This will permanently remove access to your data in DriftGuide. All trips, photos, catches, saved flies, and locations you created will be deleted from your account (we keep anonymized technical records where required).\n\nThis cannot be undone. Are you sure you want to continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete account — final confirmation',
              'Your account will be closed and you will be signed out. Type of data removed includes journal entries, album photos, and fly box. Proceed?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete my account',
                  style: 'destructive',
                  onPress: () => {
                    void (async () => {
                      setDeletingAccount(true);
                      const { error } = await softDeleteAccount();
                      setDeletingAccount(false);
                      if (error) {
                        Alert.alert('Could not delete account', error);
                      }
                    })();
                  },
                },
              ],
            );
          },
        },
      ],
    );
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

  const handleClearTripPhotoCache = useCallback(() => {
    Alert.alert(
      'Clear downloaded trip photos?',
      'Removes offline copies of trip photos on this device, including pinned trips. They will download again when you are online.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setClearingTripPhotos(true);
              try {
                await clearTripPhotoOfflineCache();
                Alert.alert('Done', 'Trip photo cache cleared.');
              } catch (e) {
                Alert.alert('Could not clear', (e as Error).message);
              } finally {
                setClearingTripPhotos(false);
              }
            })();
          },
        },
      ],
    );
  }, []);

  const handleSaveName = useCallback(async () => {
    setSavingName(true);
    const { error } = await updateProfileNames(firstNameDraft, lastNameDraft);
    setSavingName(false);
    if (error) {
      Alert.alert('Could not save', error);
      return;
    }
    await fetchProfile();
  }, [firstNameDraft, lastNameDraft, updateProfileNames, fetchProfile]);

  const showOfflineMapsInfo = useCallback(() => {
    Alert.alert(
      'Offline maps',
      'Choose your US home state to cache catalog waters for the offline map and Fish now when you do not have a signal. Clear your home state to stop state snapshots.',
    );
  }, []);

  const showTripPhotosOfflineInfo = useCallback(() => {
    Alert.alert(
      'Trip photos offline',
      'We keep photos for your last four completed trips on this device for quick loading. You can pin specific trips from a trip summary so those photos are always kept here.',
    );
  }, []);

  const handleSaveHomeState = useCallback(async () => {
    setSavingHomeState(true);
    const { error } = await updateHomeState(homeStateSelected?.name ?? null);
    setSavingHomeState(false);
    if (error) {
      Alert.alert('Could not save', error);
      return;
    }
    await fetchProfile();
    void fetchLocations();
  }, [homeStateSelected, updateHomeState, fetchProfile, fetchLocations]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + Spacing.xl + PLAN_TRIP_FAB_MAP_CLEARANCE },
      ]}
    >
      <View style={styles.card}>
        <Text style={[styles.nameFieldLabel, styles.nameFieldLabelFirst]}>First name</Text>
        <TextInput
          style={styles.nameInput}
          value={firstNameDraft}
          onChangeText={setFirstNameDraft}
          placeholder="First name"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="words"
          autoCorrect={false}
          editable={!savingName}
        />
        <Text style={styles.nameFieldLabel}>Last name</Text>
        <TextInput
          style={styles.nameInput}
          value={lastNameDraft}
          onChangeText={setLastNameDraft}
          placeholder="Last name"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="words"
          autoCorrect={false}
          editable={!savingName}
        />
        <Pressable
          style={[styles.primaryBtn, savingName && styles.primaryBtnDisabled]}
          onPress={handleSaveName}
          disabled={savingName}
        >
          {savingName ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={styles.primaryBtnText}>Save name</Text>
          )}
        </Pressable>
      </View>

      <View style={[styles.card, styles.sectionSpacing]}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitleInRow}>Offline maps</Text>
          <Pressable
            style={styles.sectionInfoHit}
            onPress={showOfflineMapsInfo}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="About offline maps"
          >
            <MaterialIcons name="info-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
        <Pressable
          style={[styles.pickerButton, savingHomeState && styles.primaryBtnDisabled]}
          onPress={() => setStateModalOpen(true)}
          disabled={savingHomeState}
        >
          {homeStateSelected ? (
            <Text style={styles.pickerButtonText}>
              {homeStateSelected.name} ({homeStateSelected.code})
            </Text>
          ) : (
            <Text style={styles.pickerPlaceholder}>Tap to choose your state</Text>
          )}
        </Pressable>
        {homeStateSelected ? (
          <Pressable
            style={styles.clearHomeState}
            onPress={() => setHomeStateSelected(null)}
            disabled={savingHomeState}
          >
            <Text style={styles.clearHomeStateText}>Clear home state</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.primaryBtn, savingHomeState && styles.primaryBtnDisabled]}
          onPress={handleSaveHomeState}
          disabled={savingHomeState}
        >
          {savingHomeState ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={styles.primaryBtnText}>Save home state</Text>
          )}
        </Pressable>
      </View>

      <UsStatePickerModal
        visible={stateModalOpen}
        onClose={() => setStateModalOpen(false)}
        onSelect={setHomeStateSelected}
      />

      <View style={[styles.card, styles.sectionSpacing]}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitleInRow}>Trip photos offline</Text>
          <Pressable
            style={styles.sectionInfoHit}
            onPress={showTripPhotosOfflineInfo}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="About trip photos offline"
          >
            <MaterialIcons name="info-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
        <Pressable
          style={[styles.primaryBtn, clearingTripPhotos && styles.primaryBtnDisabled]}
          onPress={handleClearTripPhotoCache}
          disabled={clearingTripPhotos}
        >
          {clearingTripPhotos ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={styles.primaryBtnText}>Clear downloaded trip photos</Text>
          )}
        </Pressable>
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
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.appearanceRow}>
          <View style={styles.appearanceLabelWrap}>
            <Text style={styles.bodyText}>Dark mode</Text>
          </View>
          <Switch
            value={darkModeEnabled}
            onValueChange={setDarkModeEnabled}
            trackColor={{ false: colors.border, true: colors.primaryLight }}
            thumbColor={colors.surfaceElevated}
          />
        </View>
      </View>

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
        <Pressable style={styles.signOutRow} onPress={handleSignOut} disabled={deletingAccount}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
        <Pressable
          style={styles.deleteAccountRow}
          onPress={handleDeleteAccount}
          disabled={deletingAccount}
        >
          {deletingAccount ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <Text style={styles.signOutText}>Delete account</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}
