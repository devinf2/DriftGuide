import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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

import { TripCatchPickerModal } from '@/src/components/feed/TripCatchPickerModal';
import type { ShareToFeedDraft } from '@/src/components/feed/ShareToFeedModal';
import { TripPhotoVisibilityDropdown } from '@/src/components/TripPhotoVisibilityDropdown';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { createPost } from '@/src/services/feedService';
import { uploadPhotoToStorage } from '@/src/services/photoService';
import { useAuthStore } from '@/src/stores/authStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { TripPhotoVisibility } from '@/src/types';

type PostType = 'photo' | 'trip';

const TYPE_OPTIONS: { value: PostType; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { value: 'photo', label: 'Photo', icon: 'photo-library' },
  { value: 'trip', label: 'Trip', icon: 'map' },
];

export default function CreatePostScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const me = useAuthStore((s) => s.user);

  const [type, setType] = useState<PostType>('photo');
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<TripPhotoVisibility>(
    profile?.default_trip_photo_visibility ?? 'friends_only',
  );
  const [addedMedia, setAddedMedia] = useState<string[]>([]);
  const [tripDraft, setTripDraft] = useState<ShareToFeedDraft | null>(null);
  const [tripPickerOpen, setTripPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const tripMedia = useMemo(
    () => (tripDraft?.media ?? []).filter((u) => /^https?:\/\//i.test(u)),
    [tripDraft],
  );

  const canPost =
    type === 'photo' ? caption.trim().length > 0 || addedMedia.length > 0 : tripDraft != null;

  const handleAddPhoto = useCallback(async () => {
    if (uploading || saving) return;
    if (!me?.id) {
      Alert.alert('Sign in required', 'Sign in to add a photo.');
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to photos to add one to your post.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const { url } = await uploadPhotoToStorage(me.id, result.assets[0].uri);
      setAddedMedia((prev) => [...prev, url]);
    } catch {
      Alert.alert('Upload failed', 'Could not upload that photo. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [me?.id, saving, uploading]);

  const handlePost = useCallback(async () => {
    if (saving || !canPost) return;
    setSaving(true);
    const created = await createPost(
      type === 'trip' && tripDraft
        ? {
            tripId: tripDraft.tripId ?? null,
            caption: caption.trim() || null,
            media: tripMedia,
            visibility,
          }
        : {
            caption: caption.trim() || null,
            media: addedMedia,
            visibility,
          },
    );
    setSaving(false);
    if (!created) {
      Alert.alert('Could not share', 'Something went wrong. Please try again.');
      return;
    }
    router.back();
  }, [addedMedia, canPost, caption, router, saving, tripDraft, tripMedia, type, visibility]);

  const captionPlaceholder =
    type === 'trip' ? 'Say something about this trip…' : "What's on your mind?";
  const currentType = TYPE_OPTIONS.find((t) => t.value === type) ?? TYPE_OPTIONS[0];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Close">
          <MaterialIcons name="close" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Create post</Text>
        <Pressable onPress={handlePost} disabled={!canPost || saving} hitSlop={8}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={[styles.headerPost, !canPost && styles.headerPostDisabled]}>Post</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 44}
      >
        <ScrollView
          style={styles.flex1}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Post type dropdown */}
          <Pressable style={styles.typeDropdown} onPress={() => setTypePickerOpen(true)}>
            <MaterialIcons name={currentType.icon} size={18} color={colors.primary} />
            <Text style={styles.typeDropdownText}>{currentType.label}</Text>
            <MaterialIcons name="arrow-drop-down" size={22} color={colors.primary} />
          </Pressable>

          {type === 'photo' ? (
            <>
              <Text style={styles.label}>
                {addedMedia.length > 0 ? `Photos (${addedMedia.length})` : 'Photos'}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.thumbsRow}
                keyboardShouldPersistTaps="handled"
              >
                {addedMedia.map((uri) => (
                  <Image key={uri} source={{ uri }} style={styles.thumb} contentFit="cover" />
                ))}
                <Pressable
                  style={[styles.thumb, styles.addThumb]}
                  onPress={handleAddPhoto}
                  disabled={uploading || saving}
                  accessibilityLabel="Add photo"
                >
                  {uploading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <MaterialIcons name="add-a-photo" size={22} color={colors.textSecondary} />
                  )}
                </Pressable>
              </ScrollView>
            </>
          ) : tripDraft ? (
            <>
              <View style={styles.tripHeader}>
                <View style={styles.tripHeaderIcon}>
                  <MaterialIcons name="map" size={20} color={colors.primary} />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.tripHeaderTitle} numberOfLines={1}>
                    {tripDraft.tripTitle ?? 'Fishing trip'}
                  </Text>
                  {tripDraft.tripSubtitle ? (
                    <Text style={styles.tripHeaderSub} numberOfLines={1}>
                      {tripDraft.tripSubtitle}
                    </Text>
                  ) : null}
                </View>
                <Pressable onPress={() => setTripPickerOpen(true)} hitSlop={8}>
                  <Text style={styles.changeLink}>Change</Text>
                </Pressable>
              </View>
              <Text style={styles.label}>
                {tripMedia.length > 0 ? `Photos (${tripMedia.length})` : 'Photos'}
              </Text>
              {tripMedia.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.thumbsRow}
                  keyboardShouldPersistTaps="handled"
                >
                  {tripMedia.map((uri) => (
                    <Image key={uri} source={{ uri }} style={styles.thumb} contentFit="cover" />
                  ))}
                </ScrollView>
              ) : (
                <Text style={styles.noPhotoNote}>This trip has no shareable photos.</Text>
              )}
            </>
          ) : (
            <Pressable style={styles.chooseTrip} onPress={() => setTripPickerOpen(true)}>
              <MaterialIcons name="add" size={22} color={colors.primary} />
              <Text style={styles.chooseTripText}>Choose a trip</Text>
            </Pressable>
          )}

          <Text style={styles.label}>Caption</Text>
          <TextInput
            style={styles.input}
            value={caption}
            onChangeText={setCaption}
            placeholder={captionPlaceholder}
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={2000}
          />

          <View style={styles.visibilityRow}>
            <TripPhotoVisibilityDropdown
              value={visibility}
              onChange={setVisibility}
              label="Who can see this"
              modalTitle="Post visibility"
              fullWidth
              showInfo={false}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Post type picker */}
      <Modal visible={typePickerOpen} transparent animationType="fade" onRequestClose={() => setTypePickerOpen(false)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setTypePickerOpen(false)}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Post type</Text>
            {TYPE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={[styles.pickerOption, type === opt.value && styles.pickerOptionActive]}
                onPress={() => {
                  setType(opt.value);
                  setTypePickerOpen(false);
                }}
              >
                <MaterialIcons
                  name={opt.icon}
                  size={20}
                  color={type === opt.value ? colors.primary : colors.textSecondary}
                />
                <Text style={[styles.pickerOptionText, type === opt.value && styles.pickerOptionTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <TripCatchPickerModal
        visible={tripPickerOpen}
        mode="trip"
        onClose={() => setTripPickerOpen(false)}
        onPicked={(draft) => {
          setTripDraft(draft);
          setTripPickerOpen(false);
        }}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    flex1: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    headerPost: { fontSize: FontSize.md, fontWeight: '700', color: colors.primary },
    headerPostDisabled: { color: colors.textTertiary },
    content: { padding: Spacing.lg },
    typeDropdown: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      alignSelf: 'flex-start',
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.sm,
      backgroundColor: `${colors.primary}14`,
      marginBottom: Spacing.md,
    },
    typeDropdownText: { fontSize: FontSize.sm, fontWeight: '700', color: colors.primary },
    label: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: 4,
      marginTop: Spacing.xs,
    },
    thumbsRow: { flexDirection: 'row', gap: Spacing.sm, paddingBottom: Spacing.sm },
    thumb: { width: 72, height: 72, borderRadius: BorderRadius.sm, backgroundColor: colors.surface },
    addThumb: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: 'dashed',
    },
    noPhotoNote: { fontSize: FontSize.sm, color: colors.textTertiary, marginBottom: Spacing.sm },
    chooseTrip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.lg,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: 'dashed',
      marginBottom: Spacing.sm,
    },
    chooseTripText: { fontSize: FontSize.md, fontWeight: '600', color: colors.primary },
    tripHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.sm,
      padding: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    tripHeaderIcon: {
      width: 36,
      height: 36,
      borderRadius: BorderRadius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: `${colors.primary}18`,
    },
    tripHeaderTitle: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    tripHeaderSub: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 1 },
    changeLink: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.sm,
      padding: Spacing.sm,
      minHeight: 120,
      maxHeight: 260,
      color: colors.text,
      fontSize: FontSize.md,
      textAlignVertical: 'top',
      marginBottom: Spacing.md,
    },
    visibilityRow: { marginBottom: Spacing.md },
    pickerBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center',
      padding: Spacing.lg,
    },
    pickerCard: { backgroundColor: colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
    pickerTitle: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
      paddingHorizontal: Spacing.xs,
    },
    pickerOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.sm,
    },
    pickerOptionActive: { backgroundColor: `${colors.primary}18` },
    pickerOptionText: { fontSize: FontSize.md, color: colors.text },
    pickerOptionTextActive: { fontWeight: '700', color: colors.primary },
  });
}
