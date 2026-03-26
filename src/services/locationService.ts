import { supabase } from './supabase';
import { Location, LocationType, NearbyLocationResult } from '@/src/types';

const EARTH_RADIUS_KM = 6371;

/** Distance in km between two points. Use for filtering spots by "near me". */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function trigramSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const an = normalize(a);
  const bn = normalize(b);
  if (an === bn) return 1;
  if (an.length < 3 || bn.length < 3) return 0;

  const trigrams = (s: string): Set<string> => {
    const t = new Set<string>();
    for (let i = 0; i <= s.length - 3; i++) t.add(s.slice(i, i + 3));
    return t;
  };

  const ta = trigrams(an);
  const tb = trigrams(bn);
  let intersection = 0;
  ta.forEach(t => { if (tb.has(t)) intersection++; });
  return intersection / (ta.size + tb.size - intersection);
}

/**
 * Search for existing locations near a coordinate + optionally fuzzy-match a name.
 * Tries the Supabase RPC first (migration 002); falls back to client-side Haversine.
 */
export async function searchNearbyLocations(
  lat: number,
  lng: number,
  name: string = '',
  radiusKm: number = 5,
): Promise<NearbyLocationResult[]> {
  try {
    const { data, error } = await supabase.rpc('search_nearby_locations', {
      search_lat: lat,
      search_lng: lng,
      search_name: name,
      radius_km: radiusKm,
    });

    if (!error && data) {
      return data as NearbyLocationResult[];
    }

    return await clientSideNearbySearch(lat, lng, name, radiusKm);
  } catch {
    return await clientSideNearbySearch(lat, lng, name, radiusKm);
  }
}

async function clientSideNearbySearch(
  lat: number,
  lng: number,
  name: string,
  radiusKm: number,
): Promise<NearbyLocationResult[]> {
  const { data } = await supabase
    .from('locations')
    .select('*')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (!data) return [];

  return (data as Location[])
    .map(loc => ({
      id: loc.id,
      name: loc.name,
      type: loc.type,
      latitude: loc.latitude!,
      longitude: loc.longitude!,
      status: loc.status || 'verified',
      distance_km: haversineDistance(lat, lng, loc.latitude!, loc.longitude!),
      name_similarity: name ? trigramSimilarity(name, loc.name) : 0,
    }))
    .filter(loc => loc.distance_km <= radiusKm || loc.name_similarity > 0.3)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 10);
}

export async function addCommunityLocation(
  name: string,
  type: LocationType,
  latitude: number,
  longitude: number,
  userId: string,
  isPublic: boolean = true,
): Promise<Location | null> {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.error('addCommunityLocation: invalid coordinates', { latitude, longitude });
    return null;
  }

  const { data, error } = await supabase
    .from('locations')
    .insert({
      name: name.trim(),
      type,
      latitude: lat,
      longitude: lng,
      created_by: userId,
      status: 'community',
      usage_count: 0,
      metadata: {},
      is_public: isPublic,
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding community location:', error);
    return null;
  }

  return data as Location;
}
