/**
 * WS-G — Notification payload -> route mapping (PURE module, no native deps).
 *
 * Split out from useNotificationResponseRouting (which imports
 * expo-notifications) so this decision is unit-testable. Mirrors the UUID
 * validation used by the existing deep-link parser in app/_layout.tsx.
 */

/** Same UUID shape the deep-link parser in _layout.tsx validates against. */
export const NOTIFICATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Map a notification data payload to a route href, or null for unknown/malformed
 * payloads (e.g. a non-UUID id). Supported `data.type` values:
 *   'trip_reminder' | 'log_catches' -> /trip/:id/summary
 *   'conditions'                    -> /spot/:id
 *   'post_created' | 'post_reaction'-> /friends (the social feed)
 *   'friend_request'                -> /friends/manage?seg=requests (the Requests tab)
 *   'friend_accept'                 -> /profile/friend/:actorId (the new friend's profile)
 *   'guide_created'                 -> /guide/:actorId (the new guide's profile; admins only)
 *   'business_created'              -> /business/:entityId (the pending shop; admins only)
 *   'stats'                         -> /profile/stats
 */
export function routeForNotificationData(
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (!data || typeof data !== 'object') return null;
  const type = typeof data.type === 'string' ? data.type : null;

  switch (type) {
    case 'trip_reminder':
    case 'log_catches': {
      const id = typeof data.tripId === 'string' ? data.tripId : null;
      if (id && NOTIFICATION_UUID_RE.test(id)) return `/trip/${id}/summary`;
      return null;
    }
    case 'conditions': {
      const id = typeof data.spotId === 'string' ? data.spotId : null;
      if (id && NOTIFICATION_UUID_RE.test(id)) return `/spot/${id}`;
      return null;
    }
    case 'post_created':
    case 'post_reaction':
      return '/friends';
    case 'friend_request':
      return '/friends/manage?seg=requests';
    case 'friend_accept': {
      const id = typeof data.actorId === 'string' ? data.actorId : null;
      if (id && NOTIFICATION_UUID_RE.test(id)) return `/profile/friend/${id}`;
      return '/friends/manage';
    }
    case 'guide_created': {
      const id = typeof data.actorId === 'string' ? data.actorId : null;
      if (id && NOTIFICATION_UUID_RE.test(id)) return `/guide/${id}`;
      return null;
    }
    case 'business_created': {
      const id = typeof data.entityId === 'string' ? data.entityId : null;
      if (id && NOTIFICATION_UUID_RE.test(id)) return `/business/${id}`;
      return null;
    }
    case 'stats':
      return '/profile/stats';
    default:
      return null;
  }
}
