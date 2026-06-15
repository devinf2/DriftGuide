import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { addComment, deleteComment, listComments } from '@/src/services/feedService';
import { useAuthStore } from '@/src/stores/authStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { PostComment } from '@/src/types';
import { formatRelativeTime } from '@/src/utils/formatters';
import { profileDisplayName, profileInitialLetter } from '@/src/utils/profileDisplay';

type Props = {
  visible: boolean;
  postId: string | null;
  /** Post author — may moderate (delete) any comment on their post. */
  postAuthorId: string | null;
  onClose: () => void;
  /** Called with the live count so the feed card can update its badge. */
  onCountChange?: (postId: string, count: number) => void;
};

export function PostCommentsModal({ visible, postId, postAuthorId, onClose, onCountChange }: Props) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors);
  const insets = useSafeAreaInsets();
  const myId = useAuthStore((s) => s.user?.id ?? null);

  const [comments, setComments] = useState<PostComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  // Keep the latest callback in a ref so `load` stays stable — otherwise an inline
  // onCountChange from the parent would recreate load and re-fire the effect forever.
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  const load = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    const rows = await listComments(postId);
    setComments(rows);
    setLoading(false);
    onCountChangeRef.current?.(postId, rows.length);
  }, [postId]);

  useEffect(() => {
    if (visible && postId) void load();
    if (!visible) setDraft('');
  }, [visible, postId, load]);

  const handleSend = async () => {
    if (!postId || sending) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    const created = await addComment(postId, text);
    setSending(false);
    if (!created) {
      Alert.alert('Could not comment', 'Please try again.');
      return;
    }
    setDraft('');
    setComments((prev) => {
      const next = [...prev, created];
      onCountChange?.(postId, next.length);
      return next;
    });
  };

  const handleDelete = (c: PostComment) => {
    Alert.alert('Delete comment', 'Remove this comment?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const ok = await deleteComment(c.id);
          if (!ok) return;
          setComments((prev) => {
            const next = prev.filter((x) => x.id !== c.id);
            if (postId) onCountChange?.(postId, next.length);
            return next;
          });
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: PostComment }) => {
    const canDelete = item.author_id === myId || (postAuthorId != null && postAuthorId === myId);
    return (
      <View style={styles.row}>
        {item.author?.avatar_url ? (
          <Image source={{ uri: item.author.avatar_url }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarLetter}>{profileInitialLetter(item.author)}</Text>
          </View>
        )}
        <View style={styles.bubble}>
          <Text style={styles.name}>{profileDisplayName(item.author)}</Text>
          <Text style={styles.body}>{item.body}</Text>
          <Text style={styles.time}>{formatRelativeTime(item.created_at)}</Text>
        </View>
        {canDelete ? (
          <Pressable onPress={() => handleDelete(item)} hitSlop={8} style={styles.del}>
            <MaterialIcons name="delete-outline" size={18} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Tap outside the sheet to dismiss. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Dismiss comments"
        />
        <View style={styles.sheet}>
          <View style={styles.handleRow}>
            <Text style={styles.title}>Comments</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <MaterialIcons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={comments}
              keyExtractor={(c) => c.id}
              renderItem={renderItem}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.empty}>No comments yet. Be the first to say something.</Text>
              }
            />
          )}

          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a comment…"
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={1000}
            />
            <Pressable
              style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.5 }]}
              onPress={handleSend}
              disabled={!draft.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <MaterialIcons name="send" size={18} color={colors.textInverse} />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      // Bounded so the FlatList inside can shrink and scroll instead of collapsing.
      maxHeight: '85%',
    },
    handleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    center: { padding: Spacing.xl, alignItems: 'center' },
    // flexShrink lets the list give up space to the keyboard/composer and scroll within the sheet.
    list: { flexShrink: 1, paddingHorizontal: Spacing.md },
    listContent: { flexGrow: 1, paddingVertical: Spacing.xs },
    empty: { textAlign: 'center', color: colors.textSecondary, fontSize: FontSize.sm, padding: Spacing.xl },
    row: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm, alignItems: 'flex-start' },
    avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.background },
    avatarFallback: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarLetter: { color: colors.textInverse, fontWeight: '700', fontSize: FontSize.xs },
    bubble: { flex: 1 },
    name: { fontSize: FontSize.sm, fontWeight: '700', color: colors.text },
    body: { fontSize: FontSize.sm, color: colors.text, marginTop: 1 },
    time: { fontSize: FontSize.xs, color: colors.textTertiary, marginTop: 2 },
    del: { padding: 4 },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.sm,
      color: colors.text,
      fontSize: FontSize.sm,
      maxHeight: 100,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
