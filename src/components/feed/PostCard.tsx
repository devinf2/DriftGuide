import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { FeedPost, PostReaction } from '@/src/types';
import { POST_REACTIONS } from '@/src/types';
import { formatRelativeTime } from '@/src/utils/formatters';
import { caughtByLabel, findReactionBucket } from '@/src/utils/feed';
import { profileDisplayName, profileInitialLetter } from '@/src/utils/profileDisplay';

const REACTION_EMOJI: Record<PostReaction, string> = {
  fire: '🔥',
  fish: '🐟',
  like: '👍',
  net: '🥅',
  wow: '😮',
};

type PostCardProps = {
  item: FeedPost;
  authorIsMe: boolean;
  /** Map for the "caught by <friend>" attribution label. */
  profileByUserId: Record<string, { display_name: string }>;
  canOpenTrip: boolean;
  onOpenTrip?: () => void;
  onToggleReaction: (reaction: PostReaction) => void;
  onReport?: () => void;
  onDelete?: () => void;
};

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginHorizontal: Spacing.md,
      marginBottom: Spacing.md,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      padding: Spacing.sm,
    },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.background },
    avatarFallback: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarLetter: { color: colors.textInverse, fontWeight: '700', fontSize: FontSize.sm },
    headerText: { flex: 1 },
    authorName: { fontSize: FontSize.sm, fontWeight: '700', color: colors.text },
    metaLine: { fontSize: FontSize.xs, color: colors.textTertiary, marginTop: 1 },
    overflowBtn: { padding: 4 },
    photo: { width: '100%', aspectRatio: 1, backgroundColor: colors.background },
    body: { padding: Spacing.sm, gap: 4 },
    factsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    factChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: `${colors.primary}14`,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 4,
      borderRadius: BorderRadius.sm,
    },
    factText: { fontSize: FontSize.xs, color: colors.text, fontWeight: '600' },
    caption: { fontSize: FontSize.sm, color: colors.text, lineHeight: 20, marginTop: 2 },
    reactionsRow: {
      flexDirection: 'row',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      paddingBottom: Spacing.sm,
      flexWrap: 'wrap',
    },
    reactionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 5,
      borderRadius: BorderRadius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    reactionPillActive: {
      borderColor: colors.primary,
      backgroundColor: `${colors.primary}1A`,
    },
    reactionEmoji: { fontSize: 15 },
    reactionCount: { fontSize: FontSize.xs, color: colors.textSecondary, fontWeight: '600' },
    reactionCountActive: { color: colors.primary },
    openTrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: Spacing.sm,
      paddingBottom: Spacing.sm,
    },
    openTripText: { fontSize: FontSize.xs, color: colors.primary, fontWeight: '600' },
  });
}

export function PostCard({
  item,
  authorIsMe,
  profileByUserId,
  canOpenTrip,
  onOpenTrip,
  onToggleReaction,
  onReport,
  onDelete,
}: PostCardProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { post, author, reactions } = item;

  const hero = post.media[0] ?? null;
  const caughtBy = caughtByLabel(post, profileByUserId);
  const sizeLabel =
    post.size_inches != null ? `${Number(post.size_inches)}"` : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {author?.avatar_url ? (
          <Image source={{ uri: author.avatar_url }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarLetter}>{profileInitialLetter(author)}</Text>
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={styles.authorName} numberOfLines={1}>
            {profileDisplayName(author)}
          </Text>
          <Text style={styles.metaLine} numberOfLines={1}>
            {formatRelativeTime(post.created_at)}
            {caughtBy ? ` · caught by ${caughtBy}` : ''}
          </Text>
        </View>
        {authorIsMe && onDelete ? (
          <Pressable
            style={styles.overflowBtn}
            onPress={onDelete}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Delete post"
          >
            <MaterialIcons name="delete-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : onReport ? (
          <Pressable
            style={styles.overflowBtn}
            onPress={onReport}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Report or block"
          >
            <MaterialIcons name="more-horiz" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {hero ? <Image source={{ uri: hero }} style={styles.photo} contentFit="cover" /> : null}

      <View style={styles.body}>
        {post.species || sizeLabel || post.fly_name ? (
          <View style={styles.factsRow}>
            {post.species ? (
              <View style={styles.factChip}>
                <MaterialIcons name="set-meal" size={13} color={colors.primary} />
                <Text style={styles.factText}>
                  {post.species}
                  {sizeLabel ? ` ${sizeLabel}` : ''}
                </Text>
              </View>
            ) : sizeLabel ? (
              <View style={styles.factChip}>
                <Text style={styles.factText}>{sizeLabel}</Text>
              </View>
            ) : null}
            {post.fly_name ? (
              <View style={styles.factChip}>
                <MaterialIcons name="bug-report" size={13} color={colors.primary} />
                <Text style={styles.factText}>{post.fly_name}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}
      </View>

      <View style={styles.reactionsRow}>
        {POST_REACTIONS.map((reaction) => {
          const bucket = findReactionBucket(reactions, reaction);
          const active = !!bucket?.reacted_by_me;
          const count = bucket?.count ?? 0;
          return (
            <Pressable
              key={reaction}
              style={[styles.reactionPill, active && styles.reactionPillActive]}
              onPress={() => onToggleReaction(reaction)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${reaction} reaction${count ? `, ${count}` : ''}`}
            >
              <Text style={styles.reactionEmoji}>{REACTION_EMOJI[reaction]}</Text>
              {count > 0 ? (
                <Text style={[styles.reactionCount, active && styles.reactionCountActive]}>
                  {count}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {canOpenTrip && onOpenTrip ? (
        <Pressable style={styles.openTrip} onPress={onOpenTrip} accessibilityRole="button">
          <MaterialIcons name="map" size={14} color={colors.primary} />
          <Text style={styles.openTripText}>View trip</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
