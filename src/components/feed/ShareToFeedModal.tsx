import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { TripPhotoVisibilityDropdown } from '@/src/components/TripPhotoVisibilityDropdown';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { createPost, type CreatePostInput } from '@/src/services/feedService';
import { useAuthStore } from '@/src/stores/authStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { PostRow, TripPhotoVisibility } from '@/src/types';

/** Fields pulled from the originating trip/catch to prefill the post. */
export type ShareToFeedDraft = {
  tripId?: string | null;
  catchEventId?: string | null;
  species?: string | null;
  sizeInches?: number | null;
  flyName?: string | null;
  caughtByUserId?: string | null;
  /** Candidate remote photo urls (https). Local file:// uris are dropped — upload first. */
  media?: string[];
};

type ShareToFeedModalProps = {
  visible: boolean;
  draft: ShareToFeedDraft;
  onClose: () => void;
  onPosted?: (post: PostRow) => void;
};

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
      padding: Spacing.md,
      maxHeight: '88%',
    },
    title: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginBottom: Spacing.sm },
    thumbsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
    thumb: { width: 64, height: 64, borderRadius: BorderRadius.sm, backgroundColor: colors.background },
    factsLine: { fontSize: FontSize.sm, color: colors.textSecondary, marginBottom: Spacing.sm },
    label: { fontSize: FontSize.xs, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.sm,
      padding: Spacing.sm,
      minHeight: 72,
      color: colors.text,
      fontSize: FontSize.sm,
      textAlignVertical: 'top',
      marginBottom: Spacing.md,
    },
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

  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<TripPhotoVisibility>(
    profile?.default_trip_photo_visibility ?? 'friends_only',
  );
  const [saving, setSaving] = useState(false);

  // Only remote photos can be shown in the feed; local uris must sync first.
  const remoteMedia = useMemo(
    () => (draft.media ?? []).filter(isRemoteUrl),
    [draft.media],
  );

  const factsLine = [
    draft.species,
    draft.sizeInches != null ? `${draft.sizeInches}"` : null,
    draft.flyName,
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
    onPosted?.(created);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={(e) => e.stopPropagation()}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Share to feed</Text>

            {remoteMedia.length > 0 ? (
              <View style={styles.thumbsRow}>
                {remoteMedia.slice(0, 4).map((uri) => (
                  <Image key={uri} source={{ uri }} style={styles.thumb} contentFit="cover" />
                ))}
              </View>
            ) : (
              <Text style={styles.noPhotoNote}>
                No synced photo yet — your post will share the catch details without a photo.
              </Text>
            )}

            {factsLine ? <Text style={styles.factsLine}>{factsLine}</Text> : null}

            <Text style={styles.label}>Caption</Text>
            <TextInput
              style={styles.input}
              value={caption}
              onChangeText={setCaption}
              placeholder="Say something about this one…"
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
    </Modal>
  );
}
