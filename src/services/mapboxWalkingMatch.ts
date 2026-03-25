import { MAPBOX_ACCESS_TOKEN } from '@/src/constants/mapbox';

/** Remove consecutive duplicate coordinates (Map Matching rejects duplicates). */
export function dedupeConsecutiveLngLat(
  coordinates: [number, number][],
  eps = 1e-5,
): [number, number][] {
  const out: [number, number][] = [];
  for (const p of coordinates) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > eps || Math.abs(last[1] - p[1]) > eps) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Snap a GPS trace to nearby paths (walking profile — trails along streams, riverwalks, etc.).
 * Returns matched [lng, lat][] or null if the API fails or cannot match.
 */
export async function matchWalkingRoute(
  coordinates: [number, number][],
): Promise<[number, number][] | null> {
  if (!MAPBOX_ACCESS_TOKEN || coordinates.length < 2) return null;
  const trimmed = dedupeConsecutiveLngLat(coordinates);
  if (trimmed.length < 2) return null;

  const coordStr = trimmed.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const radiuses = trimmed.map(() => '30').join(';');
  const params = new URLSearchParams({
    access_token: MAPBOX_ACCESS_TOKEN,
    geometries: 'geojson',
    radiuses,
    steps: 'false',
    overview: 'full',
  });
  const url = `https://api.mapbox.com/matching/v5/mapbox/walking/${coordStr}?${params.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      code?: string;
      matchings?: { geometry?: { type?: string; coordinates?: [number, number][] } }[];
    };
    if (data.code !== 'Ok' || !data.matchings?.length) return null;
    const coords = data.matchings[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return coords as [number, number][];
  } catch {
    return null;
  }
}
