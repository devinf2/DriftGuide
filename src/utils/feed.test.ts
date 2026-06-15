import { describe, expect, it } from 'vitest';

import type { PostReactionSummary, PostRow } from '@/src/types';
import {
  buildFeedParams,
  canOpenTripFromPost,
  caughtByLabel,
  feedRpcName,
  hasReacted,
  normalizePostRow,
  postVisibleToReader,
  toggleReactionSummary,
  totalReactionCount,
} from '@/src/utils/feed';

const ME = 'me';
const FRIEND = 'friend';
const STRANGER = 'stranger';

function post(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: 'p1',
    author_id: STRANGER,
    trip_id: 'trip1',
    catch_event_id: null,
    caption: null,
    species: null,
    size_inches: null,
    fly_name: null,
    caught_by_user_id: null,
    media: [],
    visibility: 'public',
    created_at: '2026-06-14T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

describe('feedRpcName', () => {
  it('maps modes to RPCs', () => {
    expect(feedRpcName('friends')).toBe('feed_friends');
    expect(feedRpcName('discover')).toBe('feed_discover');
  });
});

describe('buildFeedParams', () => {
  it('defaults to page size with null cursor', () => {
    expect(buildFeedParams()).toEqual({ p_limit: 20, p_before: null });
  });
  it('passes through a before cursor', () => {
    expect(buildFeedParams({ before: '2026-01-01T00:00:00Z' })).toEqual({
      p_limit: 20,
      p_before: '2026-01-01T00:00:00Z',
    });
  });
  it('clamps limit to [1, 50]', () => {
    expect(buildFeedParams({ limit: 0 }).p_limit).toBe(20); // 0 -> default
    expect(buildFeedParams({ limit: 999 }).p_limit).toBe(50);
    expect(buildFeedParams({ limit: -5 }).p_limit).toBe(1);
    expect(buildFeedParams({ limit: 10 }).p_limit).toBe(10);
  });
});

describe('postVisibleToReader', () => {
  const friendGraph = { isAcceptedFriend: true, isBlocked: false };
  const strangerGraph = { isAcceptedFriend: false, isBlocked: false };
  const blockedGraph = { isAcceptedFriend: true, isBlocked: true };

  it('author always sees own post, even private', () => {
    expect(
      postVisibleToReader(post({ author_id: ME, visibility: 'private' }), ME, strangerGraph),
    ).toBe(true);
  });
  it('public posts visible to strangers', () => {
    expect(postVisibleToReader(post({ visibility: 'public' }), ME, strangerGraph)).toBe(true);
  });
  it('friends_only visible only to accepted friends', () => {
    expect(postVisibleToReader(post({ visibility: 'friends_only' }), ME, friendGraph)).toBe(true);
    expect(postVisibleToReader(post({ visibility: 'friends_only' }), ME, strangerGraph)).toBe(false);
  });
  it('private never visible to others', () => {
    expect(postVisibleToReader(post({ visibility: 'private' }), ME, friendGraph)).toBe(false);
  });
  it('blocking hides even public posts', () => {
    expect(postVisibleToReader(post({ visibility: 'public' }), ME, blockedGraph)).toBe(false);
  });
  it('soft-deleted posts are never visible', () => {
    expect(
      postVisibleToReader(post({ author_id: ME, deleted_at: '2026-06-14T01:00:00Z' }), ME, friendGraph),
    ).toBe(false);
  });
});

describe('canOpenTripFromPost', () => {
  it('author can open own trip', () => {
    expect(
      canOpenTripFromPost(post({ author_id: ME }), ME, { isAcceptedFriend: false, isBlocked: false }),
    ).toBe(true);
  });
  it('accepted friend can open a friend trip', () => {
    expect(
      canOpenTripFromPost(post({ author_id: FRIEND }), ME, { isAcceptedFriend: true, isBlocked: false }),
    ).toBe(true);
  });
  it('public post by a stranger does NOT grant trip access', () => {
    expect(
      canOpenTripFromPost(post({ author_id: STRANGER, visibility: 'public' }), ME, {
        isAcceptedFriend: false,
        isBlocked: false,
      }),
    ).toBe(false);
  });
  it('returns false when there is no trip', () => {
    expect(
      canOpenTripFromPost(post({ author_id: ME, trip_id: null }), ME, {
        isAcceptedFriend: true,
        isBlocked: false,
      }),
    ).toBe(false);
  });
});

describe('reaction helpers', () => {
  const reactions: PostReactionSummary[] = [
    { post_id: 'p1', reaction: 'fire', count: 3, reacted_by_me: false },
    { post_id: 'p1', reaction: 'fish', count: 1, reacted_by_me: true },
  ];

  it('totals counts', () => {
    expect(totalReactionCount(reactions)).toBe(4);
  });
  it('reports reacted state', () => {
    expect(hasReacted(reactions, 'fish')).toBe(true);
    expect(hasReacted(reactions, 'fire')).toBe(false);
  });

  it('toggle adds a brand-new reaction bucket', () => {
    const next = toggleReactionSummary(reactions, 'p1', 'like');
    expect(next.find((r) => r.reaction === 'like')).toEqual({
      post_id: 'p1',
      reaction: 'like',
      count: 1,
      reacted_by_me: true,
    });
  });
  it('toggle increments an existing un-reacted bucket', () => {
    const next = toggleReactionSummary(reactions, 'p1', 'fire');
    const fire = next.find((r) => r.reaction === 'fire');
    expect(fire).toMatchObject({ count: 4, reacted_by_me: true });
  });
  it('toggle off removes a bucket that hits zero', () => {
    const next = toggleReactionSummary(reactions, 'p1', 'fish');
    expect(next.find((r) => r.reaction === 'fish')).toBeUndefined();
  });
});

describe('caughtByLabel', () => {
  const profiles = { [FRIEND]: { display_name: 'Casey' } };
  it('returns the attributed friend name', () => {
    expect(caughtByLabel(post({ author_id: ME, caught_by_user_id: FRIEND }), profiles)).toBe('Casey');
  });
  it('returns null when caught by the author', () => {
    expect(caughtByLabel(post({ author_id: ME, caught_by_user_id: ME }), profiles)).toBeNull();
    expect(caughtByLabel(post({ author_id: ME, caught_by_user_id: null }), profiles)).toBeNull();
  });
});

describe('normalizePostRow', () => {
  it('coerces jsonb media + numeric size', () => {
    const row = normalizePostRow({
      id: 'x',
      author_id: 'a',
      media: ['u1', 2, 'u2', null],
      size_inches: '14.5',
      created_at: '2026-06-14T00:00:00Z',
    });
    expect(row.media).toEqual(['u1', 'u2']);
    expect(row.size_inches).toBe(14.5);
    expect(row.visibility).toBe('friends_only');
  });
});
