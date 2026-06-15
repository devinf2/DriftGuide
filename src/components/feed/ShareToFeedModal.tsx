import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { TripPhotoVisibilityDropdown } from '@/src/components/TripPhotoVisibilityDropdown';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { createPost, type CreatePostInput } from '@/src/services/feedService';
import { uploadPhotoToStorage } from '@/src/services/photoService';
import { useAuthStore } from '@/src/stores/authStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { PostRow, TripPhotoVisibility } from '@/src/types';
import { presentationLabel } from '@/src/utils/feed';

export type ShareToFeedKind = 'quick' | 'catch' | 'trip';

/** Fields pulled from the originating trip/catch to prefill the post. */
export type ShareToFeedDraft = {
  /** Drives the composer's header + copy. Inferred from ids when omitted. */
  kind?: ShareToFeedKind;
  tripId?: string | null;
  catchEventId?: string | null;
  species?: string | null;
  sizeInches?: number | null;
  flyName?: string | null;
  depthFt?: number | null;
  presentation?: string | null;
  /** Candidate water/location name. Only shared if the author flips the location toggle on. */
  locationName?: string | null;
  caughtByUserId?: string | null;
  /** Trip-post header (e.g. location name + date · fish count). */
  tripTitle?: string | null;
  tripSubtitle?: string | null;
  /** Candidate remote photo urls (https). Local file:// uris are dropped — upload first. */
  media?: string[];
};

function draftKind(draft: ShareToFeedDraft): ShareToFeedKind {
  return draft.kind ?? (draft.catchEventId ? 'catch' : draft.tripId ? 'trip' : 'quick');
}


type ShareToFeedModalProps = {
  visible: boolean;
  draft: ShareToFeedDraft;
  onClose: () => void;
  onPosted?: (post: PostRow) => void;
};

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex1: { flex: 1 },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      padding: Spacing.md,
      maxHeight: '92%',
    },
    scrollContent: { paddingBottom: Spacing.md },
    title: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginBottom: Spacing.sm },
    tripHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: colors.background,
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
    thumbsScroll: { marginBottom: Spacing.sm },
    thumbsRow: { flexDirection: 'row', gap: Spacing.sm },
    thumb: { width: 64, height: 64, borderRadius: BorderRadius.sm, backgroundColor: colors.background },
    addThumb: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: 'dashed',
    },
    factsLine: { fontSize: FontSize.sm, color: colors.textSecondary, marginBottom: Spacing.sm },
    label: { fontSize: FontSize.xs, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.sm,
      padding: Spacing.sm,
      minHeight: 120,
      maxHeight: 240,
      color: colors.text,
      fontSize: FontSize.md,
      textAlignVertical: 'top',
      marginBottom: Spacing.md,
    },
    locationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: colors.background,
      borderRadius: BorderRadius.sm,
      padding: Spacing.sm,
      marginBottom: Spacing.md,
    },
    locationLabel: { fontSize: FontSize.sm, fontWeight: '600', color: colors.text },
    locationValue: { fontSize: FontSize.xs, color: colors.textSecondary, marginTop: 1 },
    visibilityRow: { marginBottom: Spacing.md },
    noPhotoNote: { fontSize: FontSize.xs, color: colors.textTertiary, marginBottom: Spacing.sm },
    actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
    btn: {
      flex: 1,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
      alignItems: 'center',
    },
    cancelBtn: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    cancelText: { color: colors.text, fontWeight: '600', fontSize: FontSize.sm },
    postBtn: { backgroundColor: colors.primary },
    postText: { color: colors.textInverse, fontWeight: '700', fontSize: FontSize.sm },
  });
}

function isRemoteUrl(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

export function ShareToFeedModal({ visible, draft, onClose, onPosted }: ShareToFeedModalProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const profile = useAuthStore((s) => s.profile);
  const me = useAuthStore((s) => s.user);

  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<TripPhotoVisibility>(
    profile?.default_trip_photo_visibility ?? 'friends_only',
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Location is opt-in: off by default so a post never reveals where it was caught.
  const [includeLocation, setIncludeLocation] = useState(false);
  const candidateLocation = draft.locationName?.trim() || draft.tripTitle?.trim() || null;
  // Photos the user adds in this composer (already uploaded → remote https urls).
  const [addedMedia, setAddedMedia] = useState<string[]>([]);

  // Only remote photos can be shown in the feed; local uris must sync first.
  const draftMedia = useMemo(() => (draft.media ?? []).filter(isRemoteUrl), [draft.media]);
  const remoteMedia = useMemo(() => [...draftMedia, ...addedMedia], [draftMedia, addedMedia]);

  const handleAddPhoto = async () => {
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
  };

  const kind = draftKind(draft);
  const title = kind === 'catch' ? 'Share a catch' : kind === 'trip' ? 'Share a trip' : 'Quick post';
  const captionPlaceholder =
    kind === 'quick' ? "What's on your mind?" : 'Say something about this one…';

  const factsLine = [
    draft.species,
    draft.sizeInches != null ? `${draft.sizeInches}"` : null,
    draft.flyName,
    presentationLabel(draft.presentation),
    draft.depthFt != null ? `${draft.depthFt} ft` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const handlePost = async () => {
    if (saving) return;
    setSaving(true);
    const input: CreatePostInput = {
      tripId: draft.tripId ?? null,
      catchEventId: draft.catchEventId ?? null,
      caption: caption.trim() || null,
      species: draft.species ?? null,
      sizeInches: draft.sizeInches ?? null,
      flyName: draft.flyName ?? null,
      depthFt: draft.depthFt ?? null,
      presentation: draft.presentation ?? null,
      locationName: includeLocation ? candidateLocation : null,
      caughtByUserId: draft.caughtByUserId ?? null,
      media: remoteMedia,
      visibility,
    };
    const created = await createPost(input);
    setSaving(false);
    if (!created) {
      Alert.alert('Could not share', 'Something went wrong. Please try again.');
      return;
    }
    setCaption('');
    setAddedMedia([]);
    setIncludeLocation(false);
    onPosted?.(created);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
          <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}
            >
              <Text style={styles.title}>{title}</Text>

              {kind === 'trip' && (draft.tripTitle || draft.tripSubtitle) ? (
                <View style={styles.tripHeader}>
                  <View style={styles.tripHeaderIcon}>
                    <MaterialIcons name="map" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.flex1}>
                    {draft.tripTitle ? (
                      <Text style={styles.tripHeaderTitle} numberOfLines={1}>
                        {draft.tripTitle}
                      </Text>
                    ) : null}
                    {draft.tripSubtitle ? (
                      <Text style={styles.tripHeaderSub} numberOfLines={1}>
                        {draft.tripSubtitle}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}

              <Text style={styles.label}>
                {remoteMedia.length > 0
                  ? `Photos (${remoteMedia.length})`
                  : 'Photos'}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.thumbsScroll}
                contentContainerStyle={styles.thumbsRow}
                keyboardShouldPersistTaps="handled"
              >
                {remoteMedia.map((uri) => (
                  <Image key={uri} source={{ uri }} style={styles.thumb} contentFit="cover" />
                ))}
                <Pressable
                  style={[styles.thumb, styles.addThumb]}
                  onPress={handleAddPhoto}
                  disabled={uploading || saving}
                  accessibilityRole="button"
                  accessibilityLabel="Add photo"
                >
                  {uploading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <MaterialIcons name="add-a-photo" size={22} color={colors.textSecondary} />
                  )}
                </Pressable>
              </ScrollView>

              {factsLine ? <Text style={styles.factsLine}>{factsLine}</Text> : null}

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

            {candidateLocation ? (
              <View style={styles.locationRow}>
                <View style={styles.flex1}>
                  <Text style={styles.locationLabel}>Include location</Text>
                  <Text style={styles.locationValue} numberOfLines={1}>
                    {includeLocation ? candidateLocation : 'Hidden — only fish details are shared'}
                  </Text>
                </View>
                <Switch
                  value={includeLocation}
                  onValueChange={setIncludeLocation}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  accessibilityLabel="Include location in this post"
                />
              </View>
            ) : null}

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

            <View style={styles.actions}>
              <Pressable style={[styles.btn, styles.cancelBtn]} onPress={onClose} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.postBtn, saving && { opacity: 0.6 }]}
                onPress={handlePost}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.postText}>Post</Text>
                )}
              </Pressable>
            </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}
