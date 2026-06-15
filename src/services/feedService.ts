import { supabase } from '@/src/services/supabase';
import type {
  FeedPost,
  PostComment,
  PostReaction,
  PostReactionSummary,
  PostRow,
  Profile,
  TripPhotoVisibility,
} from '@/src/types';
import {
  buildFeedParams,
  feedRpcName,
  normalizePostRow,
  type ServerFeedMode,
} from '@/src/utils/feed';

export type CreatePostInput = {
  tripId?: string | null;
  catchEventId?: string | null;
  caption?: string | null;
  species?: string | null;
  sizeInches?: number | null;
  flyName?: string | null;
  depthFt?: number | null;
  presentation?: string | null;
  /** Only pass when the author opts in to share location; otherwise leave null. */
  locationName?: string | null;
  caughtByUserId?: string | null;
  media?: string[];
  visibility: TripPhotoVisibility;
};

/** Insert a post authored by the current user. Returns the created row or null on failure. */
export async function createPost(input: CreatePostInput): Promise<PostRow | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;

  const { data, error } = await supabase
    .from('posts')
    .insert({
      author_id: uid,
      trip_id: input.tripId ?? null,
      catch_event_id: input.catchEventId ?? null,
      caption: input.caption ?? null,
      species: input.species ?? null,
      size_inches: input.sizeInches ?? null,
      fly_name: input.flyName ?? null,
      depth_ft: input.depthFt ?? null,
      presentation: input.presentation ?? null,
      location_name: input.locationName ?? null,
      caught_by_user_id: input.caughtByUserId ?? null,
      media: input.media ?? [],
      visibility: input.visibility,
    })
    .select('*')
    .single();

  if (error) {
    console.warn('[createPost]', error);
    return null;
  }
  return normalizePostRow(data as Record<string, unknown>);
}

/** Soft-delete a post the current user authored. */
export async function deletePost(postId: string): Promise<boolean> {
  const { error } = await supabase
    .from('posts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', postId);
  if (error) {
    console.warn('[deletePost]', error);
    return false;
  }
  return true;
}

async function fetchReactionSummaries(postIds: string[]): Promise<PostReactionSummary[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase.rpc('post_reactions_summary', { p_post_ids: postIds });
  if (error) {
    console.warn('[fetchReactionSummaries]', error);
    return [];
  }
  return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
    post_id: String(r.post_id),
    reaction: r.reaction as PostReaction,
    count: Number(r.count),
    reacted_by_me: Boolean(r.reacted_by_me),
  }));
}

async function fetchCommentCounts(postIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (postIds.length === 0) return counts;
  const { data, error } = await supabase.rpc('post_comment_counts', { p_post_ids: postIds });
  if (error) {
    console.warn('[fetchCommentCounts]', error);
    return counts;
  }
  for (const r of (data as Record<string, unknown>[]) ?? []) {
    counts.set(String(r.post_id), Number(r.count));
  }
  return counts;
}

async function fetchAuthorProfiles(authorIds: string[]): Promise<Record<string, Profile>> {
  const unique = Array.from(new Set(authorIds));
  if (unique.length === 0) return {};
  const { data, error } = await supabase.from('profiles').select('*').in('id', unique);
  if (error) {
    console.warn('[fetchAuthorProfiles]', error);
    return {};
  }
  const map: Record<string, Profile> = {};
  for (const p of (data as Profile[]) ?? []) map[p.id] = p;
  return map;
}

/**
 * Fetch one page of the feed (friends or discover), then enrich with author profiles and
 * reaction summaries. RLS + the feed RPC guarantee only visible posts come back.
 */
export async function fetchFeedPage(
  mode: ServerFeedMode,
  opts?: { limit?: number; before?: string | null },
): Promise<FeedPost[]> {
  const params = buildFeedParams(opts);
  const { data, error } = await supabase.rpc(feedRpcName(mode), params);
  if (error) {
    console.warn('[fetchFeedPage]', mode, error);
    return [];
  }
  const posts = ((data as Record<string, unknown>[]) ?? []).map(normalizePostRow);
  if (posts.length === 0) return [];

  const [profiles, reactions, commentCounts] = await Promise.all([
    fetchAuthorProfiles(posts.map((p) => p.author_id)),
    fetchReactionSummaries(posts.map((p) => p.id)),
    fetchCommentCounts(posts.map((p) => p.id)),
  ]);

  const reactionsByPost = new Map<string, PostReactionSummary[]>();
  for (const r of reactions) {
    const list = reactionsByPost.get(r.post_id) ?? [];
    list.push(r);
    reactionsByPost.set(r.post_id, list);
  }

  return posts.map((post) => ({
    post,
    author: profiles[post.author_id] ?? null,
    reactions: reactionsByPost.get(post.id) ?? [],
    commentCount: commentCounts.get(post.id) ?? 0,
  }));
}

/**
 * Fetch one page of the current user's own posts (newest first), enriched like the feed.
 * Reads the posts table directly — RLS lets an author see all their own (non-deleted) posts.
 */
export async function fetchMyPosts(opts?: {
  limit?: number;
  before?: string | null;
}): Promise<FeedPost[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];

  const { p_limit, p_before } = buildFeedParams(opts);
  let query = supabase
    .from('posts')
    .select('*')
    .eq('author_id', uid)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(p_limit);
  if (p_before) query = query.lt('created_at', p_before);

  const { data, error } = await query;
  if (error) {
    console.warn('[fetchMyPosts]', error);
    return [];
  }
  const posts = ((data as Record<string, unknown>[]) ?? []).map(normalizePostRow);
  if (posts.length === 0) return [];

  const [profiles, reactions, commentCounts] = await Promise.all([
    fetchAuthorProfiles([uid]),
    fetchReactionSummaries(posts.map((p) => p.id)),
    fetchCommentCounts(posts.map((p) => p.id)),
  ]);

  const reactionsByPost = new Map<string, PostReactionSummary[]>();
  for (const r of reactions) {
    const list = reactionsByPost.get(r.post_id) ?? [];
    list.push(r);
    reactionsByPost.set(r.post_id, list);
  }

  return posts.map((post) => ({
    post,
    author: profiles[post.author_id] ?? null,
    reactions: reactionsByPost.get(post.id) ?? [],
    commentCount: commentCounts.get(post.id) ?? 0,
  }));
}

/** List visible comments on a post (oldest first), with author profiles joined. */
export async function listComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await supabase
    .from('post_comments')
    .select('*')
    .eq('post_id', postId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[listComments]', error);
    return [];
  }
  const rows = (data as Record<string, unknown>[]) ?? [];
  const profiles = await fetchAuthorProfiles(rows.map((r) => String(r.author_id)));
  return rows.map((r) => ({
    id: String(r.id),
    post_id: String(r.post_id),
    author_id: String(r.author_id),
    body: String(r.body ?? ''),
    created_at: String(r.created_at),
    author: profiles[String(r.author_id)] ?? null,
  }));
}

/** Add a comment to a post as the current user. Returns the created comment or null. */
export async function addComment(postId: string, body: string): Promise<PostComment | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  const text = body.trim();
  if (!uid || !text) return null;
  const { data, error } = await supabase
    .from('post_comments')
    .insert({ post_id: postId, author_id: uid, body: text })
    .select('*')
    .single();
  if (error) {
    console.warn('[addComment]', error);
    return null;
  }
  const r = data as Record<string, unknown>;
  const profiles = await fetchAuthorProfiles([uid]);
  return {
    id: String(r.id),
    post_id: String(r.post_id),
    author_id: String(r.author_id),
    body: String(r.body ?? ''),
    created_at: String(r.created_at),
    author: profiles[uid] ?? null,
  };
}

/** Soft-delete a comment (own comment, or any comment on a post you authored). */
export async function deleteComment(commentId: string): Promise<boolean> {
  const { error } = await supabase
    .from('post_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', commentId);
  if (error) {
    console.warn('[deleteComment]', error);
    return false;
  }
  return true;
}

/** Trip + events + photos behind a "whole trip" post — readable by anyone who can see the post. */
export type PostTripView = {
  trip: Record<string, unknown>;
  location: Record<string, unknown> | null;
  events: Record<string, unknown>[];
  photos: Record<string, unknown>[];
};

export async function fetchPostTripView(postId: string): Promise<PostTripView | null> {
  const { data, error } = await supabase.rpc('post_trip_view', { p_post_id: postId });
  if (error) {
    console.warn('[fetchPostTripView]', error);
    return null;
  }
  if (!data) return null;
  const obj = data as { trip?: unknown; location?: unknown; events?: unknown; photos?: unknown };
  if (!obj.trip) return null;
  return {
    trip: obj.trip as Record<string, unknown>,
    location: (obj.location as Record<string, unknown>) ?? null,
    events: (obj.events as Record<string, unknown>[]) ?? [],
    photos: (obj.photos as Record<string, unknown>[]) ?? [],
  };
}

/** Add the current user's reaction to a post (idempotent via unique constraint). */
export async function addReaction(postId: string, reaction: PostReaction): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return false;
  const { error } = await supabase
    .from('post_reactions')
    .upsert(
      { post_id: postId, user_id: uid, reaction },
      { onConflict: 'post_id,user_id,reaction', ignoreDuplicates: true },
    );
  if (error) {
    console.warn('[addReaction]', error);
    return false;
  }
  return true;
}

/** Remove the current user's reaction from a post. */
export async function removeReaction(postId: string, reaction: PostReaction): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return false;
  const { error } = await supabase
    .from('post_reactions')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', uid)
    .eq('reaction', reaction);
  if (error) {
    console.warn('[removeReaction]', error);
    return false;
  }
  return true;
}

/** Report a (public) post for moderation. */
export async function reportPost(postId: string, reason?: string): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return false;
  const { error } = await supabase
    .from('post_reports')
    .upsert(
      { post_id: postId, reporter_id: uid, reason: reason ?? null },
      { onConflict: 'post_id,reporter_id', ignoreDuplicates: true },
    );
  if (error) {
    console.warn('[reportPost]', error);
    return false;
  }
  return true;
}

/**
 * Block another user via the existing friendships graph (status='blocked').
 * Reuses the same pair model as the friends workstream so Discover hides their content.
 * TODO(friends): if a richer block flow exists in friendsService, route through it instead.
 */
export async function blockUser(otherUserId: string): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid || uid === otherUserId) return false;
  const profile_min = uid < otherUserId ? uid : otherUserId;
  const profile_max = uid < otherUserId ? otherUserId : uid;
  const { error } = await supabase
    .from('friendships')
    .upsert(
      { profile_min, profile_max, status: 'blocked', requested_by: uid },
      { onConflict: 'profile_min,profile_max' },
    );
  if (error) {
    console.warn('[blockUser]', error);
    return false;
  }
  return true;
}
