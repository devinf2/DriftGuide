/**
 * GoTrue treats the session as "expired" when `expires_at` is within ~90s of `Date.now()`
 * and then calls the refresh endpoint. Offline cold starts need the persisted row read
 * without forcing that refresh; see `supabaseAuthStorage.ts`.
 */
export const OFFLINE_AUTH_EXPIRY_LEEWAY_SEC = 48 * 60 * 60; // 48h — above GoTrue EXPIRY_MARGIN (~90s)

/** Returns adjusted JSON or `null` if the payload should pass through unchanged. */
export function stretchPersistedAuthSessionJsonForOfflineRead(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { refresh_token?: unknown }).refresh_token !== 'string' ||
      typeof (parsed as { access_token?: unknown }).access_token !== 'string'
    ) {
      return null;
    }
    const session = parsed as Record<string, unknown>;
    const nowSec = Math.floor(Date.now() / 1000);
    return JSON.stringify({
      ...session,
      expires_at: nowSec + OFFLINE_AUTH_EXPIRY_LEEWAY_SEC,
    });
  } catch {
    return null;
  }
}
