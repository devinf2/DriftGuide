import { describe, expect, it } from 'vitest';
import {
  resolveActivityRecipients,
  type ActivityEventInput,
} from './activityRecipients';

describe('resolveActivityRecipients', () => {
  it('fans out a post_created to the actor accepted friends, excluding the actor', () => {
    const event: ActivityEventInput = {
      id: 'e1',
      type: 'post_created',
      actor_id: 'actor',
      recipient_id: null,
      post_id: 'p1',
    };
    const r = resolveActivityRecipients(event, ['friendA', 'friendB', 'actor'], 'Dana');
    expect(r.map((x) => x.userId).sort()).toEqual(['friendA', 'friendB']);
    expect(r[0].data).toMatchObject({ type: 'post_created', postId: 'p1', actorId: 'actor' });
    expect(r[0].body).toContain('Dana');
  });

  it('dedupes friend ids', () => {
    const event: ActivityEventInput = {
      id: 'e1',
      type: 'post_created',
      actor_id: 'actor',
      recipient_id: null,
      post_id: 'p1',
    };
    const r = resolveActivityRecipients(event, ['friendA', 'friendA'], 'Dana');
    expect(r).toHaveLength(1);
  });

  it('delivers a post_reaction directly to the recipient', () => {
    const event: ActivityEventInput = {
      id: 'e2',
      type: 'post_reaction',
      actor_id: 'reactor',
      recipient_id: 'author',
      post_id: 'p9',
    };
    const r = resolveActivityRecipients(event, [], 'Sam');
    expect(r).toHaveLength(1);
    expect(r[0].userId).toBe('author');
    expect(r[0].data).toMatchObject({ type: 'post_reaction', postId: 'p9' });
  });

  it('skips a self-reaction', () => {
    const event: ActivityEventInput = {
      id: 'e3',
      type: 'post_reaction',
      actor_id: 'me',
      recipient_id: 'me',
      post_id: 'p1',
    };
    expect(resolveActivityRecipients(event, [], 'Me')).toHaveLength(0);
  });

  it('skips a reaction with no recipient', () => {
    const event: ActivityEventInput = {
      id: 'e4',
      type: 'post_reaction',
      actor_id: 'reactor',
      recipient_id: null,
      post_id: 'p1',
    };
    expect(resolveActivityRecipients(event, [], 'Sam')).toHaveLength(0);
  });

  it('falls back to a generic actor name', () => {
    const event: ActivityEventInput = {
      id: 'e5',
      type: 'post_created',
      actor_id: 'actor',
      recipient_id: null,
      post_id: null,
    };
    const r = resolveActivityRecipients(event, ['f1'], '   ');
    expect(r[0].body).toContain('A friend');
  });
});
