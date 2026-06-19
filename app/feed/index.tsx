import { Stack, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PostCard } from '@/src/components/feed/PostCard';
import { PostCommentsModal } from '@/src/components/feed/PostCommentsModal';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { blockUser, deletePost, reportPost } from '@/src/services/feedService';
import { useAuthStore } from '@/src/stores/authStore';
import { useFeedStore } from '@/src/stores/feedStore';
import { useFriendsStore } from '@/src/stores/friendsStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { FeedPost } from '@/src/types';
import { canOpenTripFromPost, type FeedMode } from '@/src/utils/feed';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.sm,
    },
    headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: colors.text },
    backBtn: { padding: 4 },
    segments: {
      flexDirection: 'row',
      marginHorizontal: Spacing.md,
      marginBottom: Spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 3,
    },
    segment: {
      flex: 1,
      paddingVertical: Spacing.sm,
      alignItems: 'center',
      borderRadius: BorderRadius.sm,
    },
    segmentActive: { backgroundColor: colors.primary },
    segmentText: { fontSize: FontSize.sm, fontWeight: '700', color: colors.textSecondary },
    segmentTextActive: { color: colors.textInverse },
    empty: { alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm },
    emptyText: { fontSize: FontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    footer: { padding: Spacing.lg, alignItems: 'center' },
  });
}

export default function FeedScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const topInset = useEffectiveSafeTopInset();
  const router = useRouter();

  const me = useAuthStore((s) => s.user);
  const myId = me?.id ?? null;

  const friendships = useFriendsStore((s) => s.friendships);
  const friendProfiles = useFriendsStore((s) => s.profileByUserId);
  const refreshFriends = useFriendsStore((s) => s.refresh);

  const byMode = useFeedStore((s) => s.byMode);
  const load = useFeedStore((s) => s.load);
  const refresh = useFeedStore((s) => s.refresh);
  const loadMore = useFeedStore((s) => s.loadMore);
  const toggleReaction = useFeedStore((s) => s.toggleReaction);
  const removePostEverywhere = useFeedStore((s) => s.removePostEverywhere);
  const setCommentCount = useFeedStore((s) => s.setCommentCount);

  const [mode, setMode] = useState<FeedMode>('friends');
  const [commentsTarget, setCommentsTarget] = useState<{ postId: string; authorId: string } | null>(
    null,
  );
  const state = byMode[mode];

  useEffect(() => {
    if (myId) refreshFriends(myId);
  }, [myId, refreshFriends]);

  useEffect(() => {
    if (state.posts.length === 0 && !state.loading) load(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Accepted-friend + block lookups from the friends graph.
  const graphFor = useCallback(
    (authorId: string) => {
      const row = friendships.find(
        (f) =>
          (f.profile_min === authorId && f.profile_max === myId) ||
          (f.profile_max === authorId && f.profile_min === myId),
      );
      return {
        isAcceptedFriend: row?.status === 'accepted',
        isBlocked: row?.status === 'blocked',
      };
    },
    [friendships, myId],
  );

  const profileNameMap = useMemo(() => {
    const map: Record<string, { display_name: string }> = {};
    for (const [id, p] of Object.entries(friendProfiles)) map[id] = { display_name: p.display_name };
    return map;
  }, [friendProfiles]);

  const handleModeration = useCallback(
    (item: FeedPost) => {
      const authorName = item.author?.display_name ?? 'this angler';
      Alert.alert('Post options', undefined, [
        {
          text: 'Report post',
          onPress: async () => {
            await reportPost(item.post.id);
            Alert.alert('Reported', 'Thanks — we will review this post.');
          },
        },
        {
          text: `Block ${authorName}`,
          style: 'destructive',
          onPress: async () => {
            const ok = await blockUser(item.post.author_id);
            if (ok) removePostEverywhere(item.post.id);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [removePostEverywhere],
  );

  const handleDelete = useCallback(
    (item: FeedPost) => {
      Alert.alert('Delete post', 'Remove this post from the feed?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const ok = await deletePost(item.post.id);
            if (ok) removePostEverywhere(item.post.id);
          },
        },
      ]);
    },
    [removePostEverywhere],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedPost }) => {
      const authorIsMe = item.post.author_id === myId;
      const graph = graphFor(item.post.author_id);
      // Author + accepted friends open the full interactive trip; anyone else who can see the
      // post opens the read-only, visibility-gated view (app/feed/trip/[postId]).
      const canOpenFull = !!myId && canOpenTripFromPost(item.post, myId, graph);
      const onOpenTrip = item.post.trip_id
        ? () =>
            router.push(
              (canOpenFull
                ? `/trip/${item.post.trip_id}/summary`
                : `/feed/trip/${item.post.id}`) as never,
            )
        : undefined;
      const onOpenAuthor = () =>
        authorIsMe
          ? router.push('/profile' as never)
          : router.push({ pathname: '/friends/friend/[id]', params: { id: item.post.author_id } });
      return (
        <PostCard
          item={item}
          authorIsMe={authorIsMe}
          profileByUserId={profileNameMap}
          onOpenTrip={onOpenTrip}
          onOpenAuthor={onOpenAuthor}
          onToggleReaction={(reaction) => toggleReaction(mode, item.post.id, reaction)}
          onOpenComments={() =>
            setCommentsTarget({ postId: item.post.id, authorId: item.post.author_id })
          }
          commentCount={item.commentCount}
          onReport={authorIsMe ? undefined : () => handleModeration(item)}
          onDelete={authorIsMe ? () => handleDelete(item) : undefined}
        />
      );
    },
    [myId, graphFor, profileNameMap, router, toggleReaction, mode, handleModeration, handleDelete],
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={{ paddingTop: topInset + Spacing.sm }}>
          <View style={styles.header}>
            <View style={{ width: 28 }} />
            <Text style={styles.headerTitle}>Feed</Text>
            <Pressable
              style={styles.backBtn}
              onPress={() => router.push('/friends/manage' as never)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Friends"
            >
              <MaterialIcons name="people" size={24} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.segments}>
            {(['friends', 'discover', 'mine'] as FeedMode[]).map((m) => (
              <Pressable
                key={m}
                style={[styles.segment, mode === m && styles.segmentActive]}
                onPress={() => setMode(m)}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === m }}
              >
                <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
                  {m === 'friends' ? 'Friends' : m === 'discover' ? 'Discover' : 'My Page'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {state.loading && state.posts.length === 0 ? (
          <View style={styles.footer}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={state.posts}
            keyExtractor={(item) => item.post.id}
            renderItem={renderItem}
            onEndReached={() => loadMore(mode)}
            onEndReachedThreshold={0.4}
            refreshControl={
              <RefreshControl
                refreshing={state.refreshing}
                onRefresh={() => refresh(mode)}
                tintColor={colors.primary}
              />
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <MaterialIcons name="forum" size={32} color={colors.textTertiary} />
                <Text style={styles.emptyText}>
                  {mode === 'friends'
                    ? 'No posts yet. Share a catch or trip, or add friends to fill your feed.'
                    : mode === 'discover'
                      ? 'No public posts yet. Check back soon.'
                      : "You haven't shared anything yet. Share a catch or trip and it'll show up here."}
                </Text>
              </View>
            }
            ListFooterComponent={
              state.loadingMore ? (
                <View style={styles.footer}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : null
            }
            contentContainerStyle={{ paddingTop: Spacing.sm, paddingBottom: Spacing.xl }}
          />
        )}

        <PostCommentsModal
          visible={commentsTarget != null}
          postId={commentsTarget?.postId ?? null}
          postAuthorId={commentsTarget?.authorId ?? null}
          onClose={() => setCommentsTarget(null)}
          onCountChange={setCommentCount}
        />
      </SafeAreaView>
    </>
  );
}
