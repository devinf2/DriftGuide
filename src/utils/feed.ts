import type {
  PostReaction,
  PostReactionSummary,
  PostRow,
  Profile,
  TripPhotoVisibility,
} from '@/src/types';

export type FeedMode = 'friends' | 'discover';

export const FEED_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** RPC name for a feed mode. */
export function feedRpcName(mode: FeedMode): 'feed_friends' | 'feed_discover' {
  return mode === 'discover' ? 'feed_discover' : 'feed_friends';
}

/**
 * Build the keyset-pagination params for a feed RPC. `before` is an exclusive upper
 * bound on created_at; pass the created_at of the last post you have to load the next page.
 */
export function buildFeedParams(opts?: {
  limit?: number;
  before?: string | null;
}): { p_limit: number; p_before: string | null } {
  const requested = opts?.limit ?? FEED_PAGE_SIZE;
  const p_limit = Math.max(1, Math.min(Math.floor(requested) || FEED_PAGE_SIZE, MAX_PAGE_SIZE));
  return { p_limit, p_before: opts?.before ?? null };
}

/**
 * Mirror of the server-side post_visible_to_reader logic, for client-side gating
 * (e.g. deciding whether a tap-through to the trip is allowed) and for tests.
 * The server RLS remains the source of truth; this is a convenience predicate.
 */
export function postVisibleToReader(
  post: Pick<PostRow, 'author_id' | 'visibility' | 'deleted_at'>,
  readerId: string,
  graph: { isAcceptedFriend: boolean; isBlocked: boolean },
): boolean {
  if (post.deleted_at) return false;
  if (post.author_id === readerId) return true;
  if (graph.isBlocked) return false;
  if (post.visibility === 'public') return true;
  if (post.visibility === 'friends_only') return graph.isAcceptedFriend;
  return false; // 'private'
}

/** Whether tapping a feed card may navigate to the underlying trip summary. */
export function canOpenTripFromPost(
  post: Pick<PostRow, 'author_id' | 'visibility' | 'deleted_at' | 'trip_id'>,
  readerId: string,
  graph: { isAcceptedFriend: boolean; isBlocked: boolean },
): boolean {
  if (!post.trip_id) return false;
  // The trip itself is only readable to owner/session peers/accepted-friends. A public
  // post by a non-friend should NOT grant trip access — only the author or an accepted friend.
  if (post.author_id === readerId) return true;
  if (graph.isBlocked) return false;
  return graph.isAcceptedFriend;
}

/** Total reaction count across all buckets for a post. */
export function totalReactionCount(reactions: PostReactionSummary[]): number {
  return reactions.reduce((sum, r) => sum + (r.count || 0), 0);
}

/** Find the summary bucket for a specific reaction, if any. */
export function findReactionBucket(
  reactions: PostReactionSummary[],
  reaction: PostReaction,
): PostReactionSummary | undefined {
  return reactions.find((r) => r.reaction === reaction);
}

/** True if the viewer has already applied this reaction. */
export function hasReacted(reactions: PostReactionSummary[], reaction: PostReaction): boolean {
  return !!findReactionBucket(reactions, reaction)?.reacted_by_me;
}

/**
 * Optimistically toggle a reaction in a local summary list (used before/while the server
 * round-trips). Returns a new array; never mutates the input.
 */
export function toggleReactionSummary(
  reactions: PostReactionSummary[],
  postId: string,
  reaction: PostReaction,
): PostReactionSummary[] {
  const existing = findReactionBucket(reactions, reaction);
  if (!existing) {
    return [...reactions, { post_id: postId, reaction, count: 1, reacted_by_me: true }];
  }
  const nextCount = existing.reacted_by_me
    ? Math.max(0, existing.count - 1)
    : existing.count + 1;
  const updated: PostReactionSummary = {
    ...existing,
    count: nextCount,
    reacted_by_me: !existing.reacted_by_me,
  };
  return reactions
    .map((r) => (r.reaction === reaction ? updated : r))
    .filter((r) => r.count > 0);
}

/** Build the denormalized "who caught it" label for a post card. */
export function caughtByLabel(
  post: Pick<PostRow, 'author_id' | 'caught_by_user_id'>,
  profileByUserId: Record<string, Pick<Profile, 'display_name'>>,
): string | null {
  if (!post.caught_by_user_id || post.caught_by_user_id === post.author_id) return null;
  return profileByUserId[post.caught_by_user_id]?.display_name ?? null;
}

/** Map a raw posts row (media may arrive as jsonb) into a typed PostRow with media:string[]. */
export function normalizePostRow(raw: Record<string, unknown>): PostRow {
  const media = Array.isArray(raw.media)
    ? (raw.media as unknown[]).filter((m): m is string => typeof m === 'string')
    : [];
  return {
    id: String(raw.id),
    author_id: String(raw.author_id),
    trip_id: (raw.trip_id as string | null) ?? null,
    catch_event_id: (raw.catch_event_id as string | null) ?? null,
    caption: (raw.caption as string | null) ?? null,
    species: (raw.species as string | null) ?? null,
    size_inches: raw.size_inches == null ? null : Number(raw.size_inches),
    fly_name: (raw.fly_name as string | null) ?? null,
    caught_by_user_id: (raw.caught_by_user_id as string | null) ?? null,
    media,
    visibility: (raw.visibility as TripPhotoVisibility) ?? 'friends_only',
    created_at: String(raw.created_at),
    deleted_at: (raw.deleted_at as string | null) ?? null,
  };
}
