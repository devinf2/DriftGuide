let cached: { key: string; label: string } | null = null;

/**
 * Best-effort region label for AI prompts (state/region name).
 * Uses OpenStreetMap Nominatim; cache one result per lat,lng pair per session.
 */
export async function resolveRegionLabelAsync(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): Promise<string> {
  if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return 'the western United States';
  }
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  if (cached?.key === key) return cached.label;

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(String(latitude))}` +
      `&lon=${encodeURIComponent(String(longitude))}&format=json`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'DriftGuide/1.0 (https://driftguide.app)',
      },
    });
    if (!res.ok) {
      cached = { key, label: 'the western United States' };
      return cached.label;
    }
    const j = (await res.json()) as {
      address?: { state?: string; region?: string; county?: string; country?: string };
    };
    const state = j?.address?.state || j?.address?.region;
    const country = j?.address?.country;
    const label = state ? `${state}${country && country !== 'United States' ? `, ${country}` : ''}` : 'the western United States';
    cached = { key, label };
    return label;
  } catch {
    cached = { key, label: 'the western United States' };
    return cached.label;
  }
}
