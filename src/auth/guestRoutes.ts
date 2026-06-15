/**
 * Guest browsing allowlist (WS-B).
 *
 * A freshly-installed or signed-out user may browse the read-only surfaces of the app with NO
 * account: the home screen, map, AI guide, spot detail, and the hatch calendar. Anything that
 * needs a real `user_id` (starting/saving a trip, journal, friends, profile, settings, the fly
 * box, photo album, fishing sessions) requires sign-in.
 *
 * The decision is driven by the FIRST expo-router segment (the top-level route group / folder).
 * `(tabs)` hosts home / map / guide / home/hatch-chart, so the whole group is guest-browsable;
 * the in-tab write actions (Go fishing, friends, profile) are gated separately at their entry
 * points via `requireAuth`.
 */

/** First-segment route groups a signed-out (guest) user is allowed to render. */
export const GUEST_ALLOWED_SEGMENTS: readonly string[] = [
  '(tabs)', // home, map, guide, and home/hatch-chart
  'spot', // spot detail (read-only)
  'auth', // the auth screen itself (contextual sheet + cold-start sign-in)
];

/**
 * Pure decision: may a guest (no session) render the route identified by its expo-router segments?
 *
 * `segments[0]` is the top-level group. An empty segments array is the root/index, which resolves
 * into `(tabs)` and is always allowed. Unknown/account-bound first segments are denied so the gate
 * redirects them to `/auth`.
 */
export function isGuestAllowedRoute(segments: readonly string[]): boolean {
  const top = segments[0];
  if (!top) return true; // root index → (tabs)
  return GUEST_ALLOWED_SEGMENTS.includes(top);
}
