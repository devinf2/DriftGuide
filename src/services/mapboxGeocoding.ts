import { MAPBOX_ACCESS_TOKEN } from '@/src/constants/mapbox';

export type MapboxGeocodeFeature = {
  id: string;
  place_name: string;
  center: [number, number];
  relevance?: number;
};

export type ForwardGeocodeResult = {
  features: MapboxGeocodeFeature[];
};

/**
 * Mapbox Geocoding API v5 — forward search. Uses public token from env.
 * @see https://docs.mapbox.com/api/search/geocoding/
 */
export async function forwardGeocode(
  query: string,
  options?: { proximity?: [number, number]; limit?: number },
): Promise<ForwardGeocodeResult> {
  const q = query.trim();
  if (!q || !MAPBOX_ACCESS_TOKEN) {
    return { features: [] };
  }

  const limit = options?.limit ?? 5;
  const encoded = encodeURIComponent(q);
  let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_ACCESS_TOKEN}&limit=${limit}`;
  if (options?.proximity) {
    url += `&proximity=${options.proximity[0]},${options.proximity[1]}`;
  }

  const res = await fetch(url);
  if (!res.ok) {
    return { features: [] };
  }

  const data = (await res.json()) as {
    features?: Array<{
      id: string;
      place_name: string;
      center: [number, number];
      relevance?: number;
    }>;
  };

  const features = (data.features ?? []).map((f) => ({
    id: f.id,
    place_name: f.place_name,
    center: f.center,
    relevance: f.relevance,
  }));

  return { features };
}
