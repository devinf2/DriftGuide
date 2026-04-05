import { PLAN_TRIP_FAB_MAP_CLEARANCE } from '@/src/components/PlanTripFab';
import { ProfilePhotoLibrarySection } from '@/src/components/ProfilePhotoLibrarySection';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { uploadProfileAvatar } from '@/src/services/photoService';
import { useAuthStore } from '@/src/stores/authStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { profileDisplayName, profileInitialLetter } from '@/src/utils/profileDisplay';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const R = BorderRadius.md;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

/** Matches in-app avatar: square crop from the editor is clipped to this circle. */
const AVATAR_PREVIEW_DIAMETER = Math.min(248, SCREEN_WIDTH - Spacing.md * 4);

type QuickTileProps = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  colors: ThemeColors;
  styles: any;
};

function QuickTile({ icon, label, onPress, colors, styles }: QuickTileProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.quickTile, pressed && styles.quickTilePressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.quickTileIconWrap}>
        <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={styles.quickTileLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createProfileStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, profile, fetchProfile, updateProfileNames } = useAuthStore();
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [firstNameDraft, setFirstNameDraft] = useState('');
  const [lastNameDraft, setLastNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (nameModalOpen && profile) {
      setFirstNameDraft(profile.first_name?.trim() ?? '');
      setLastNameDraft(profile.last_name?.trim() ?? '');
    }
  }, [nameModalOpen, profile]);

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
    if (!net.isConnected) {
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

  const handleAvatarPress = () => {
    if (!user || avatarUploading) return;
    Alert.alert('Profile photo', 'Choose a source', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Photo library', onPress: () => pickAvatarForPreview('library') },
      { text: 'Take photo', onPress: () => pickAvatarForPreview('camera') },
    ]);
  };

  const saveName = async () => {
    setSavingName(true);
    const { error } = await updateProfileNames(firstNameDraft, lastNameDraft);
    setSavingName(false);
    if (error) {
      Alert.alert('Could not save', error);
      return;
    }
    setNameModalOpen(false);
  };

  const displayName = profileDisplayName(profile);

  return (
    <Fragment>
      {insets.top > 0 && (
        <View
          style={[
            styles.safeAreaFill,
            { height: insets.top },
          ]}
          pointerEvents="none"
        />
      )}
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Spacing.md + insets.top,
            paddingBottom: Spacing.lg + PLAN_TRIP_FAB_MAP_CLEARANCE,
          },
        ]}
      >
        <View style={styles.headerCard}>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => setNameModalOpen(true)}
              style={styles.headerActionBtn}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Edit name"
            >
              <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.primary} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/profile/settings')}
              style={styles.headerActionBtn}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <MaterialCommunityIcons name="cog-outline" size={20} color={colors.primary} />
            </Pressable>
          </View>
          <View style={styles.headerRow}>
            <Pressable
              onPress={handleAvatarPress}
              disabled={avatarUploading}
              accessibilityRole="button"
              accessibilityLabel="Profile photo"
              accessibilityHint="Opens options to add or change your profile picture"
              style={({ pressed }) => [styles.avatarPressable, pressed && styles.avatarPressablePressed]}
            >
              <View style={styles.avatarWrapper}>
                <View style={styles.avatar}>
                  {profile?.avatar_url ? (
                    <Image
                      source={{ uri: profile.avatar_url }}
                      style={styles.avatarImage}
                      contentFit="cover"
                      transition={200}
                    />
                  ) : (
                    <Text style={styles.avatarText}>{profileInitialLetter(profile)}</Text>
                  )}
                  {avatarUploading ? (
                    <View style={styles.avatarLoading}>
                      <ActivityIndicator color={colors.textInverse} />
                    </View>
                  ) : null}
                </View>
                {!avatarUploading ? (
                  <View style={styles.avatarEditBadge} pointerEvents="none">
                    <MaterialCommunityIcons name="camera-plus" size={14} color={colors.primary} />
                  </View>
                ) : null}
              </View>
            </Pressable>
            <View style={styles.headerTextCol}>
              <Text style={styles.name} numberOfLines={2}>
                {displayName}
              </Text>
              <Text style={styles.email} numberOfLines={1}>
                {user?.email}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.quickRow}>
          <QuickTile icon="hook" label="Fly Box" onPress={() => router.push('/fly-box')} colors={colors} styles={styles} />
          <QuickTile icon="map-outline" label="Offline maps" onPress={() => router.push('/profile/offline-maps')} colors={colors} styles={styles} />
          <QuickTile icon="chart-line" label="Stats" onPress={() => router.push('/profile/stats')} colors={colors} styles={styles} />
        </View>

        <ProfilePhotoLibrarySection />
      </ScrollView>

      <Modal visible={nameModalOpen} transparent animationType="fade" onRequestClose={() => setNameModalOpen(false)}>
        <Pressable style={styles.nameModalBackdrop} onPress={() => setNameModalOpen(false)}>
          <Pressable style={styles.nameModalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.nameModalTitle}>Your name</Text>
            <Text style={styles.nameModalHint}>Shown in your profile header and greetings.</Text>
            <Text style={styles.inputLabel}>First name</Text>
            <TextInput
              style={styles.input}
              value={firstNameDraft}
              onChangeText={setFirstNameDraft}
              placeholder="First name"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="words"
              editable={!savingName}
            />
            <Text style={styles.inputLabel}>Last name</Text>
            <TextInput
              style={styles.input}
              value={lastNameDraft}
              onChangeText={setLastNameDraft}
              placeholder="Last name"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="words"
              editable={!savingName}
            />
            <View style={styles.nameModalActions}>
              <Pressable
                style={styles.nameModalSecondary}
                onPress={() => setNameModalOpen(false)}
                disabled={savingName}
              >
                <Text style={styles.nameModalSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.nameModalPrimary, savingName && styles.nameModalPrimaryDisabled]}
                onPress={saveName}
                disabled={savingName}
              >
                {savingName ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.nameModalPrimaryText}>Save</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

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
          <Pressable style={StyleSheet.absoluteFill} onPress={cancelAvatarPreview} accessibilityLabel="Dismiss preview" />
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
                style={[styles.avatarPreviewBtnPrimary, avatarUploading && styles.avatarPreviewBtnPrimaryDisabled]}
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
    </Fragment>
  );
}

function createProfileStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeAreaFill: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.background,
      zIndex: 10,
    },
    container: { flex: 1, backgroundColor: colors.background },
    content: {
      paddingHorizontal: Spacing.md,
    },
    headerCard: {
      position: 'relative',
      backgroundColor: colors.surface,
      borderRadius: R,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
        android: { elevation: 2 },
      }),
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    headerTextCol: { flex: 1, minWidth: 0, paddingRight: 44 },
    avatarPressable: { borderRadius: 30 },
    avatarPressablePressed: { opacity: 0.85 },
    avatarWrapper: { width: 56, height: 56, position: 'relative' },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    avatarEditBadge: {
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
    avatarImage: { width: '100%', height: '100%' },
    avatarLoading: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: { fontSize: FontSize.xxl, fontWeight: '700', color: colors.textInverse },
    name: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text },
    email: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: Spacing.xs },
    headerActions: {
      position: 'absolute',
      top: Spacing.sm,
      right: Spacing.sm,
      zIndex: 1,
      flexDirection: 'column',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    headerActionBtn: {
      padding: Spacing.xs,
    },
    quickRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.md },
    quickTile: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.xs,
      paddingHorizontal: 4,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 72,
      borderWidth: 1,
      borderColor: colors.border,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3 },
        android: { elevation: 1 },
      }),
    },
    quickTilePressed: { opacity: 0.92 },
    quickTileIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 2,
    },
    quickTileLabel: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
    },
    nameModalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      padding: Spacing.md,
    },
    nameModalCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    nameModalTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    nameModalHint: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: Spacing.xs, marginBottom: Spacing.md },
    inputLabel: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: Spacing.xs,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      fontSize: FontSize.md,
      color: colors.text,
      marginBottom: Spacing.md,
    },
    nameModalActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
    nameModalSecondary: {
      flex: 1,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    nameModalSecondaryText: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    nameModalPrimary: {
      flex: 1,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.primary,
      minHeight: 48,
    },
    nameModalPrimaryDisabled: { opacity: 0.75 },
    nameModalPrimaryText: { fontSize: FontSize.md, fontWeight: '600', color: colors.textInverse },
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
  });
}
