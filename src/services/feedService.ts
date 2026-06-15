import { supabase } from '@/src/services/supabase';
import type {
  FeedPost,
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
  type FeedMode,
} from '@/src/utils/feed';

export type CreatePostInput = {
  tripId?: string | null;
  catchEventId?: string | null;
  caption?: string | null;
  species?: string | null;
  sizeInches?: number | null;
  flyName?: string | null;
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
  mode: FeedMode,
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

  const [profiles, reactions] = await Promise.all([
    fetchAuthorProfiles(posts.map((p) => p.author_id)),
    fetchReactionSummaries(posts.map((p) => p.id)),
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
  }));
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
