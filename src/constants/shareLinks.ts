/**
 * Public HTTPS page for trip share previews (Open Graph). Point this at your deployed
 * Supabase Edge Function, without a trailing slash, e.g.:
 * `https://<project-ref>.supabase.co/functions/v1/share-trip`
 *
 * Set explicitly via `EXPO_PUBLIC_SHARE_TRIP_BASE_URL` in `.env` / EAS env. When that is
 * unset we derive it from `EXPO_PUBLIC_SUPABASE_URL` (the share-trip function lives at
 * `<supabase-url>/functions/v1/share-trip`), so a deployed function unfurls correctly even
 * without the dedicated var. Returns null only when neither is configured.
 */
export function getShareTripPageBaseUrl(): string | null {
  const explicit = process.env.EXPO_PUBLIC_SHARE_TRIP_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/share-trip`;
  }
  return null;
}

export function buildShareTripUrl(tripId: string): string | null {
  const base = getShareTripPageBaseUrl();
  if (!base) return null;
  return `${base}?trip_id=${encodeURIComponent(tripId)}`;
}
