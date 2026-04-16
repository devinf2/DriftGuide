/**
 * Public HTTPS page for trip share previews (Open Graph). Point this at your deployed
 * Supabase Edge Function, without a trailing slash, e.g.:
 * `https://<project-ref>.supabase.co/functions/v1/share-trip`
 *
 * Set via `EXPO_PUBLIC_SHARE_TRIP_BASE_URL` in `.env` / EAS env.
 */
export function getShareTripPageBaseUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_SHARE_TRIP_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

export function buildShareTripUrl(tripId: string): string | null {
  const base = getShareTripPageBaseUrl();
  if (!base) return null;
  return `${base}?trip_id=${encodeURIComponent(tripId)}`;
}
