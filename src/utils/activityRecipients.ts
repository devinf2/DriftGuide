/**
 * WS-G — Activity-event recipient resolution (PURE module, no native deps).
 *
 * Given an unprocessed activity_event and the actor's accepted-friends list,
 * decide who should receive a push. The activity-push edge function
 * (supabase/functions/activity-push/) mirrors this logic in Deno against the
 * real DB; this pure copy is unit-tested in activityRecipients.test.ts.
 *
 * activity_events shape (must match WS-H migration 117):
 *   type: 'post_created' | 'post_reaction'
 *   actor_id:     who did the thing
 *   recipient_id: NULL on 'post_created' (fan out to actor's accepted friends);
 *                 set on 'post_reaction' (the post author, direct)
 */

export type ActivityEventType = 'post_created' | 'post_reaction';

export interface ActivityEventInput {
  id: string;
  type: ActivityEventType;
  actor_id: string;
  recipient_id: string | null;
  post_id: string | null;
}

export interface ResolvedRecipient {
  userId: string;
  title: string;
  body: string;
  data: { type: ActivityEventType; postId: string | null; actorId: string };
}

/**
 * Resolve recipient user ids for one event.
 *
 * - 'post_created': fan out to the actor's accepted friends (provided by
 *   caller), excluding the actor themself.
 * - 'post_reaction': deliver directly to `recipient_id` (the post author),
 *   unless the author reacted to their own post (self-reaction → no push).
 *
 * `actorName` is woven into the copy. `acceptedFriendIds` is only consulted for
 * 'post_created'.
 */
export function resolveActivityRecipients(
  event: ActivityEventInput,
  acceptedFriendIds: string[],
  actorName: string,
): ResolvedRecipient[] {
  const name = actorName.trim() || 'A friend';

  if (event.type === 'post_created') {
    const unique = new Set<string>();
    for (const id of acceptedFriendIds) {
      if (id && id !== event.actor_id) unique.add(id);
    }
    return [...unique].map((userId) => ({
      userId,
      title: 'New from your friends',
      body: `${name} shared a new post.`,
      data: { type: event.type, postId: event.post_id, actorId: event.actor_id },
    }));
  }

  // post_reaction
  if (!event.recipient_id) return [];
  if (event.recipient_id === event.actor_id) return []; // self-reaction, skip
  return [
    {
      userId: event.recipient_id,
      title: 'Someone liked your post',
      body: `${name} reacted to your post.`,
      data: { type: event.type, postId: event.post_id, actorId: event.actor_id },
    },
  ];
}
