import { PLAN_TRIP_FAB_MAP_CLEARANCE } from '@/src/components/PlanTripFab';
import { TripPhotoVisibilityDropdown } from '@/src/components/TripPhotoVisibilityDropdown';
import { showTripPhotoVisibilityInfoAlert } from '@/src/constants/tripPhotoVisibility';
import { UsStatePickerModal } from '@/src/components/UsStatePickerModal';
import { matchStoredProfileHomeState, type UsStateOption } from '@/src/constants/usStates';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { uploadProfileAvatar } from '@/src/services/photoService';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { useTripStore } from '@/src/stores/tripStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { effectiveIsAppOnline, isAppReachableFromNetInfoState } from '@/src/utils/netReachability';
import { profileInitialLetter } from '@/src/utils/profileDisplay';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const appVersion = Constants.expoConfig?.version ?? '1.0.0';
const CONTACT_EMAIL = 'DriftGuideApp@gmail.com';
/** Lowercase a–z, digits, underscore; 3–20 chars (matches server `set_my_username`). */
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const AVATAR_PREVIEW_DIAMETER = Math.min(248, SCREEN_WIDTH - Spacing.md * 4);

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
    contactUsPressable: {
      alignSelf: 'flex-start',
      marginTop: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    contactUsLabel: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginBottom: Spacing.xs,
    },
    contactEmailLink: {
      fontSize: FontSize.sm,
      color: colors.primary,
      fontWeight: '600',
      textDecorationLine: 'underline',
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
    profileCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: Spacing.md + 2,
      paddingVertical: Spacing.md,
    },
    profileHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.md,
      paddingBottom: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
      gap: Spacing.sm,
    },
    profileHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      flex: 1,
      minWidth: 0,
    },
    profileHeaderLeftEdit: {
      alignItems: 'flex-start',
    },
    profileEditInputsCol: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
    },
    nameInputBesideAvatar: {
      marginBottom: Spacing.sm,
    },
    nameInputBesideAvatarLast: {
      marginBottom: 0,
    },
    profileNamesBesideAvatar: {
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
      gap: 2,
    },
    profileNameBesideAvatar: {
      fontSize: FontSize.lg,
      fontWeight: '600',
      color: colors.text,
      letterSpacing: -0.15,
    },
    settingsAvatarWrapper: { width: 56, height: 56, position: 'relative' },
    settingsAvatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    settingsAvatarImage: { width: '100%', height: '100%' },
    settingsAvatarText: { fontSize: FontSize.xxl, fontWeight: '700', color: colors.textInverse },
    settingsAvatarLoading: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    settingsAvatarEditBadge: {
      position: 'absolute',
      right: -4,
      bottom: -4,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: 'center',
      alignItems: 'center',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.2,
          shadowRadius: 2,
        },
        android: { elevation: 3 },
      }),
    },
    avatarPreviewBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
    },
    avatarPreviewCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      zIndex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
        },
        android: { elevation: 8 },
      }),
    },
    avatarPreviewTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, textAlign: 'center' },
    avatarPreviewSubtext: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: Spacing.sm,
      lineHeight: 20,
    },
    avatarPreviewCircle: {
      alignSelf: 'center',
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: colors.borderLight,
    },
    avatarPreviewImage: { width: '100%', height: '100%' },
    avatarPreviewActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    avatarPreviewBtnSecondary: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      minWidth: 140,
      alignItems: 'center',
    },
    avatarPreviewBtnSecondaryText: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    avatarPreviewBtnPrimary: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.primary,
      minWidth: 140,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarPreviewBtnPrimaryDisabled: { opacity: 0.75 },
    avatarPreviewBtnPrimaryText: { fontSize: FontSize.md, fontWeight: '600', color: colors.textInverse },
    editIconButton: {
      width: 40,
      height: 40,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    readOnlyCell: {
      paddingHorizontal: 0,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.sm,
    },
    readOnlyCellSeparator: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
      marginBottom: Spacing.xs,
      paddingBottom: Spacing.sm,
    },
    readOnlyCellLabel: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: Spacing.xs,
    },
    readOnlyCellLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      marginBottom: Spacing.xs,
    },
    readOnlyCellLabelFlex: { flex: 1 },
    readOnlyCellLabelInRow: { marginBottom: 0 },
    readOnlyValue: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.text,
      letterSpacing: -0.1,
    },
    readOnlyPlaceholder: { color: colors.textTertiary, fontWeight: '400' },
    profileActionsRow: {
      flexDirection: 'row',
      gap: Spacing.md,
      marginTop: Spacing.md,
    },
    secondaryBtn: {
      flex: 1,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    secondaryBtnText: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    primaryBtnFlex: { flex: 1, marginTop: 0 },
  });
}

export default function ProfileSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors, darkModeEnabled, setDarkModeEnabled } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    user,
    signOut,
    softDeleteAccount,
    profile,
    updateHomeState,
    updateProfileNames,
    updateUsername,
    fetchProfile,
    updateDefaultTripPhotoVisibility,
  } = useAuthStore();
  const fetchLocations = useLocationStore((s) => s.fetchLocations);
  const { pendingSyncTrips, retryPendingSyncs, isSyncingPending } = useTripStore();
  const [homeStateSelected, setHomeStateSelected] = useState<UsStateOption | null>(null);
  const [stateModalOpen, setStateModalOpen] = useState(false);
  const [savingProfileSection, setSavingProfileSection] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [firstNameDraft, setFirstNameDraft] = useState('');
  const [lastNameDraft, setLastNameDraft] = useState('');
  const [usernameDraft, setUsernameDraft] = useState('');
  const [editingProfileSection, setEditingProfileSection] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  const [savingPhotoVisibility, setSavingPhotoVisibility] = useState(false);

  useEffect(() => {
    setHomeStateSelected(matchStoredProfileHomeState(profile?.home_state));
  }, [profile?.home_state]);

  useEffect(() => {
    setFirstNameDraft(profile?.first_name?.trim() ?? '');
    setLastNameDraft(profile?.last_name?.trim() ?? '');
    setUsernameDraft(profile?.username?.trim() ?? '');
  }, [profile?.first_name, profile?.last_name, profile?.username]);

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

  const handleContactUs = useCallback(() => {
    void (async () => {
      try {
        await Linking.openURL(CONTACT_MAILTO);
      } catch {
        Alert.alert(
          'Contact us',
          `Mail could not be opened on this device (for example, the iOS Simulator has no Mail app).\n\n${CONTACT_EMAIL}`,
          [
            {
              text: 'Share email',
              onPress: () => void Share.share({ message: CONTACT_EMAIL, title: 'DriftGuide support' }),
            },
            { text: 'OK', style: 'cancel' },
          ],
        );
      }
    })();
  }, []);

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

  const resetProfileDraftsFromProfile = useCallback(() => {
    setFirstNameDraft(profile?.first_name?.trim() ?? '');
    setLastNameDraft(profile?.last_name?.trim() ?? '');
    setUsernameDraft(profile?.username?.trim() ?? '');
    setHomeStateSelected(matchStoredProfileHomeState(profile?.home_state));
  }, [profile?.first_name, profile?.last_name, profile?.username, profile?.home_state]);

  const handleCancelProfileEdit = useCallback(() => {
    resetProfileDraftsFromProfile();
    setStateModalOpen(false);
    setAvatarPreviewUri(null);
    setEditingProfileSection(false);
  }, [resetProfileDraftsFromProfile]);

  const pickAvatarForPreview = useCallback(async (source: 'library' | 'camera') => {
    if (!user) return;
    if (source === 'camera') {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (!cam.granted) {
        Alert.alert(
          'Camera',
          'Camera access is turned off. You can enable it in Settings for DriftGuide.',
        );
        return;
      }
    } else {
      const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!lib.granted) {
        Alert.alert('Photos', 'Photo library access is needed to choose a profile picture.');
        return;
      }
    }

    const launch =
      source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await launch({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (result.canceled || !result.assets[0]?.uri) return;
    setAvatarPreviewUri(result.assets[0].uri);
  }, [user]);

  const confirmAvatarPreview = useCallback(async () => {
    if (!user || !avatarPreviewUri) return;
    const net = await NetInfo.fetch();
    if (!effectiveIsAppOnline(isAppReachableFromNetInfoState(net))) {
      Alert.alert('Offline', 'Connect to the internet to upload a profile photo.');
      return;
    }
    setAvatarUploading(true);
    try {
      await uploadProfileAvatar(user.id, avatarPreviewUri, {
        previousAvatarUrl: profile?.avatar_url,
      });
      await fetchProfile();
      setAvatarPreviewUri(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong.';
      Alert.alert('Upload failed', msg);
    } finally {
      setAvatarUploading(false);
    }
  }, [user, avatarPreviewUri, profile?.avatar_url, fetchProfile]);

  const cancelAvatarPreview = useCallback(() => {
    setAvatarPreviewUri(null);
  }, []);

  const handleSettingsAvatarPhotoPress = useCallback(() => {
    if (!user || avatarUploading) return;
    Alert.alert('Profile photo', 'Choose a source', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Photo library', onPress: () => pickAvatarForPreview('library') },
      { text: 'Take photo', onPress: () => pickAvatarForPreview('camera') },
    ]);
  }, [user, avatarUploading, pickAvatarForPreview]);

  const handleSaveProfileSection = useCallback(async () => {
    setSavingProfileSection(true);
    const nameResult = await updateProfileNames(firstNameDraft, lastNameDraft);
    if (nameResult.error) {
      setSavingProfileSection(false);
      Alert.alert('Could not save', nameResult.error);
      return;
    }

    const unameTrim = usernameDraft.trim().toLowerCase();
    if (usernameDraft.trim().length > 0 && !USERNAME_PATTERN.test(unameTrim)) {
      setSavingProfileSection(false);
      Alert.alert(
        'Invalid username',
        'Use 3–20 characters: lowercase letters, numbers, and underscores only. Leave blank to remove your username.',
      );
      return;
    }
    const unameResult = await updateUsername(usernameDraft);
    if (unameResult.error) {
      setSavingProfileSection(false);
      Alert.alert('Could not save', unameResult.error);
      return;
    }

    const homeResult = await updateHomeState(homeStateSelected?.name ?? null);
    setSavingProfileSection(false);
    if (homeResult.error) {
      Alert.alert('Could not save', homeResult.error);
      return;
    }
    await fetchProfile();
    void fetchLocations();
    setEditingProfileSection(false);
  }, [
    firstNameDraft,
    lastNameDraft,
    usernameDraft,
    homeStateSelected,
    updateProfileNames,
    updateUsername,
    updateHomeState,
    fetchProfile,
    fetchLocations,
  ]);

  const showOfflineMapsInfo = useCallback(() => {
    Alert.alert(
      'Offline maps',
      'Choose your US home state to cache catalog waters for the offline map and Fish now when you do not have a signal. Clear your home state to stop state snapshots.',
    );
  }, []);

  const savedHomeStateOption = useMemo(
    () => matchStoredProfileHomeState(profile?.home_state),
    [profile?.home_state],
  );

  const renderProfileAvatar = () => (
    <View style={styles.settingsAvatarWrapper}>
      <View style={styles.settingsAvatar}>
        {profile?.avatar_url ? (
          <Image
            source={{ uri: profile.avatar_url }}
            style={styles.settingsAvatarImage}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <Text style={styles.settingsAvatarText}>{profileInitialLetter(profile)}</Text>
        )}
        {editingProfileSection && avatarUploading ? (
          <View style={styles.settingsAvatarLoading}>
            <ActivityIndicator color={colors.textInverse} />
          </View>
        ) : null}
      </View>
      {editingProfileSection && !avatarUploading ? (
        <Pressable
          style={({ pressed }) => [styles.settingsAvatarEditBadge, pressed && { opacity: 0.85 }]}
          onPress={handleSettingsAvatarPhotoPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
        >
          <MaterialCommunityIcons name="camera-plus" size={14} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + Spacing.xl + PLAN_TRIP_FAB_MAP_CLEARANCE },
      ]}
    >
      <View style={[styles.card, styles.profileCard]}>
        <View style={styles.profileHeaderRow}>
          <View
            style={[
              styles.profileHeaderLeft,
              editingProfileSection && styles.profileHeaderLeftEdit,
            ]}
          >
            {renderProfileAvatar()}
            {!editingProfileSection ? (
              <View style={styles.profileNamesBesideAvatar}>
                <Text
                  style={[
                    styles.profileNameBesideAvatar,
                    !profile?.first_name?.trim() && styles.readOnlyPlaceholder,
                  ]}
                  numberOfLines={1}
                  accessibilityLabel="First name"
                >
                  {profile?.first_name?.trim() || 'Not set'}
                </Text>
                <Text
                  style={[
                    styles.profileNameBesideAvatar,
                    !profile?.last_name?.trim() && styles.readOnlyPlaceholder,
                  ]}
                  numberOfLines={1}
                  accessibilityLabel="Last name"
                >
                  {profile?.last_name?.trim() || 'Not set'}
                </Text>
              </View>
            ) : (
              <View style={styles.profileEditInputsCol}>
                <Text style={[styles.nameFieldLabel, styles.nameFieldLabelFirst]}>First name</Text>
                <TextInput
                  style={[styles.nameInput, styles.nameInputBesideAvatar]}
                  value={firstNameDraft}
                  onChangeText={setFirstNameDraft}
                  placeholder="First name"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="words"
                  autoCorrect={false}
                  editable={!savingProfileSection && !avatarUploading}
                />
                <Text style={styles.nameFieldLabel}>Last name</Text>
                <TextInput
                  style={[styles.nameInput, styles.nameInputBesideAvatar, styles.nameInputBesideAvatarLast]}
                  value={lastNameDraft}
                  onChangeText={setLastNameDraft}
                  placeholder="Last name"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="words"
                  autoCorrect={false}
                  editable={!savingProfileSection && !avatarUploading}
                />
              </View>
            )}
          </View>
          {!editingProfileSection ? (
            <Pressable
              style={({ pressed }) => [styles.editIconButton, pressed && { opacity: 0.85 }]}
              onPress={() => setEditingProfileSection(true)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
            >
              <MaterialIcons name="edit" size={20} color={colors.primaryLight} />
            </Pressable>
          ) : null}
        </View>

        {!editingProfileSection ? (
          <>
            <View style={[styles.readOnlyCell, styles.readOnlyCellSeparator]}>
              <Text style={styles.readOnlyCellLabel}>Username</Text>
              <Text
                style={[styles.readOnlyValue, !profile?.username?.trim() && styles.readOnlyPlaceholder]}
                numberOfLines={1}
              >
                {profile?.username?.trim() ? `@${profile.username.trim()}` : 'Not set — add one when editing profile'}
              </Text>
            </View>
            <View style={styles.readOnlyCell}>
              <View style={styles.readOnlyCellLabelRow}>
                <Text
                  style={[
                    styles.readOnlyCellLabel,
                    styles.readOnlyCellLabelFlex,
                    styles.readOnlyCellLabelInRow,
                  ]}
                >
                  Offline maps
                </Text>
                <Pressable
                  style={styles.sectionInfoHit}
                  onPress={showOfflineMapsInfo}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="About offline maps"
                >
                  <MaterialIcons name="info-outline" size={20} color={colors.textTertiary} />
                </Pressable>
              </View>
              <Text
                style={[
                  styles.readOnlyValue,
                  !savedHomeStateOption && styles.readOnlyPlaceholder,
                ]}
                numberOfLines={2}
              >
                {savedHomeStateOption
                  ? `${savedHomeStateOption.name} (${savedHomeStateOption.code})`
                  : 'Not set'}
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.nameFieldLabel}>Username</Text>
            <Text style={[styles.bodyText, { marginBottom: Spacing.sm }]}>
              Optional handle for friend search (lowercase letters, numbers, underscores). Leave blank to remove.
            </Text>
            <TextInput
              style={styles.nameInput}
              value={usernameDraft}
              onChangeText={setUsernameDraft}
              placeholder="e.g. river_rat_42"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              editable={!savingProfileSection && !avatarUploading}
            />
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
              style={[
                styles.pickerButton,
                (savingProfileSection || avatarUploading) && styles.primaryBtnDisabled,
              ]}
              onPress={() => setStateModalOpen(true)}
              disabled={savingProfileSection || avatarUploading}
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
                disabled={savingProfileSection || avatarUploading}
              >
                <Text style={styles.clearHomeStateText}>Clear home state</Text>
              </Pressable>
            ) : null}
            <View style={styles.profileActionsRow}>
              <Pressable
                style={styles.secondaryBtn}
                onPress={handleCancelProfileEdit}
                disabled={savingProfileSection || avatarUploading}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.primaryBtn,
                  styles.primaryBtnFlex,
                  (savingProfileSection || avatarUploading) && styles.primaryBtnDisabled,
                ]}
                onPress={handleSaveProfileSection}
                disabled={savingProfileSection || avatarUploading}
              >
                {savingProfileSection ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.primaryBtnText}>Save</Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </View>

      <UsStatePickerModal
        visible={stateModalOpen}
        onClose={() => setStateModalOpen(false)}
        onSelect={setHomeStateSelected}
      />

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
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitleInRow}>Trip photos on profile</Text>
          <Pressable
            style={styles.sectionInfoHit}
            onPress={() => showTripPhotoVisibilityInfoAlert()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="What trip photo sharing means"
          >
            <MaterialIcons name="info-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
        <Text style={[styles.bodyText, { marginBottom: Spacing.md }]}>
          Default for new trips. You can override each trip on its summary screen.
        </Text>
        <TripPhotoVisibilityDropdown
          fullWidth
          showInfo={false}
          label="Visible to"
          value={profile?.default_trip_photo_visibility ?? 'private'}
          onChange={(v) => {
            void (async () => {
              setSavingPhotoVisibility(true);
              const r = await updateDefaultTripPhotoVisibility(v);
              setSavingPhotoVisibility(false);
              if (r.error) Alert.alert('Could not save', r.error);
            })();
          }}
          disabled={savingPhotoVisibility}
          saving={savingPhotoVisibility}
        />
      </View>

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
        <Pressable
          style={styles.contactUsPressable}
          onPress={handleContactUs}
          accessibilityRole="link"
          accessibilityLabel={`Email ${CONTACT_EMAIL}`}
        >
          <Text style={styles.contactUsLabel}>Contact us</Text>
          <Text style={styles.contactEmailLink}>{CONTACT_EMAIL}</Text>
        </Pressable>
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

    <Modal
      visible={avatarPreviewUri != null}
      animationType="fade"
      transparent
      onRequestClose={cancelAvatarPreview}
    >
      <View
        style={[
          styles.avatarPreviewBackdrop,
          {
            paddingTop: insets.top + Spacing.md,
            paddingBottom: insets.bottom + Spacing.md,
          },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={cancelAvatarPreview}
          accessibilityLabel="Dismiss preview"
        />
        <View style={[styles.avatarPreviewCard, { marginHorizontal: Spacing.md }]}>
          <Text style={styles.avatarPreviewTitle}>Profile picture</Text>
          <Text style={styles.avatarPreviewSubtext}>
            The photo editor uses a square frame. On your profile it appears as a circle, like this:
          </Text>
          <View
            style={[
              styles.avatarPreviewCircle,
              {
                width: AVATAR_PREVIEW_DIAMETER,
                height: AVATAR_PREVIEW_DIAMETER,
                borderRadius: AVATAR_PREVIEW_DIAMETER / 2,
              },
            ]}
          >
            {avatarPreviewUri ? (
              <Image
                source={{ uri: avatarPreviewUri }}
                style={styles.avatarPreviewImage}
                contentFit="cover"
              />
            ) : null}
          </View>
          <View style={styles.avatarPreviewActions}>
            <Pressable
              onPress={cancelAvatarPreview}
              style={styles.avatarPreviewBtnSecondary}
              disabled={avatarUploading}
            >
              <Text style={styles.avatarPreviewBtnSecondaryText}>Choose another</Text>
            </Pressable>
            <Pressable
              onPress={confirmAvatarPreview}
              style={[
                styles.avatarPreviewBtnPrimary,
                avatarUploading && styles.avatarPreviewBtnPrimaryDisabled,
              ]}
              disabled={avatarUploading}
            >
              {avatarUploading ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.avatarPreviewBtnPrimaryText}>Use this photo</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}
