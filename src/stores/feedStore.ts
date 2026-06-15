import { create } from 'zustand';

import {
  addReaction,
  fetchFeedPage,
  fetchMyPosts,
  removeReaction,
} from '@/src/services/feedService';
import type { FeedPost, PostReaction } from '@/src/types';
import {
  FEED_PAGE_SIZE,
  hasReacted,
  toggleReactionSummary,
  type FeedMode,
} from '@/src/utils/feed';

/** Fetch a page for any mode — 'mine' reads the posts table, others use the feed RPCs. */
function fetchPage(
  mode: FeedMode,
  opts?: { limit?: number; before?: string | null },
): Promise<FeedPost[]> {
  return mode === 'mine' ? fetchMyPosts(opts) : fetchFeedPage(mode, opts);
}

type ModeState = {
  posts: FeedPost[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  reachedEnd: boolean;
  error: string | null;
};

const emptyMode = (): ModeState => ({
  posts: [],
  loading: false,
  refreshing: false,
  loadingMore: false,
  reachedEnd: false,
  error: null,
});

type FeedState = {
  byMode: Record<FeedMode, ModeState>;
  reset: () => void;
  load: (mode: FeedMode) => Promise<void>;
  refresh: (mode: FeedMode) => Promise<void>;
  loadMore: (mode: FeedMode) => Promise<void>;
  toggleReaction: (mode: FeedMode, postId: string, reaction: PostReaction) => Promise<void>;
  /** Drop a post from all modes (after the author deletes / a viewer blocks the author). */
  removePostEverywhere: (postId: string) => void;
  /** Update a post's comment count across modes (after add/delete in the comments sheet). */
  setCommentCount: (postId: string, count: number) => void;
};

export const useFeedStore = create<FeedState>((set, get) => ({
  byMode: { friends: emptyMode(), discover: emptyMode(), mine: emptyMode() },

  reset: () =>
    set({ byMode: { friends: emptyMode(), discover: emptyMode(), mine: emptyMode() } }),

  load: async (mode) => {
    const current = get().byMode[mode];
    if (current.loading) return;
    set((s) => ({ byMode: { ...s.byMode, [mode]: { ...current, loading: true, error: null } } }));
    try {
      const page = await fetchPage(mode, { limit: FEED_PAGE_SIZE });
      set((s) => ({
        byMode: {
          ...s.byMode,
          [mode]: {
            ...s.byMode[mode],
            posts: page,
            loading: false,
            reachedEnd: page.length < FEED_PAGE_SIZE,
          },
        },
      }));
    } catch (e) {
      set((s) => ({
        byMode: {
          ...s.byMode,
          [mode]: {
            ...s.byMode[mode],
            loading: false,
            error: e instanceof Error ? e.message : 'Failed to load feed',
          },
        },
      }));
    }
  },

  refresh: async (mode) => {
    set((s) => ({ byMode: { ...s.byMode, [mode]: { ...s.byMode[mode], refreshing: true } } }));
    try {
      const page = await fetchPage(mode, { limit: FEED_PAGE_SIZE });
      set((s) => ({
        byMode: {
          ...s.byMode,
          [mode]: {
            ...s.byMode[mode],
            posts: page,
            refreshing: false,
            reachedEnd: page.length < FEED_PAGE_SIZE,
            error: null,
          },
        },
      }));
    } catch {
      set((s) => ({ byMode: { ...s.byMode, [mode]: { ...s.byMode[mode], refreshing: false } } }));
    }
  },

  loadMore: async (mode) => {
    const current = get().byMode[mode];
    if (current.loadingMore || current.reachedEnd || current.posts.length === 0) return;
    const before = current.posts[current.posts.length - 1]?.post.created_at ?? null;
    set((s) => ({ byMode: { ...s.byMode, [mode]: { ...current, loadingMore: true } } }));
    try {
      const page = await fetchPage(mode, { limit: FEED_PAGE_SIZE, before });
      set((s) => {
        const existing = s.byMode[mode];
        const seen = new Set(existing.posts.map((p) => p.post.id));
        const merged = [...existing.posts, ...page.filter((p) => !seen.has(p.post.id))];
        return {
          byMode: {
            ...s.byMode,
            [mode]: {
              ...existing,
              posts: merged,
              loadingMore: false,
              reachedEnd: page.length < FEED_PAGE_SIZE,
            },
          },
        };
      });
    } catch {
      set((s) => ({ byMode: { ...s.byMode, [mode]: { ...s.byMode[mode], loadingMore: false } } }));
    }
  },

  toggleReaction: async (mode, postId, reaction) => {
    const current = get().byMode[mode];
    const target = current.posts.find((p) => p.post.id === postId);
    if (!target) return;
    const wasReacted = hasReacted(target.reactions, reaction);

    // Optimistic update across whichever modes hold this post.
    const apply = (s: FeedState) => {
      const next = { ...s.byMode };
      for (const m of Object.keys(next) as FeedMode[]) {
        next[m] = {
          ...next[m],
          posts: next[m].posts.map((p) =>
            p.post.id === postId
              ? { ...p, reactions: toggleReactionSummary(p.reactions, postId, reaction) }
              : p,
          ),
        };
      }
      return { byMode: next };
    };
    set(apply);

    const ok = wasReacted
      ? await removeReaction(postId, reaction)
      : await addReaction(postId, reaction);
    if (!ok) {
      // revert by toggling again
      set(apply);
    }
  },

  removePostEverywhere: (postId) =>
    set((s) => {
      const next = { ...s.byMode };
      for (const m of Object.keys(next) as FeedMode[]) {
        next[m] = { ...next[m], posts: next[m].posts.filter((p) => p.post.id !== postId) };
      }
      return { byMode: next };
    }),

  setCommentCount: (postId, count) =>
    set((s) => {
      const next = { ...s.byMode };
      for (const m of Object.keys(next) as FeedMode[]) {
        next[m] = {
          ...next[m],
          posts: next[m].posts.map((p) =>
            p.post.id === postId ? { ...p, commentCount: count } : p,
          ),
        };
      }
      return { byMode: next };
    }),
}));
