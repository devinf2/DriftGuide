import { supabase } from './supabase';
import {
  LOCATION_PIN_ADJUST_THRESHOLD_KM,
  PARENT_CANDIDATE_MAX_RADIUS_KM,
} from '@/src/constants/locationThresholds';
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

/**
 * When true, choosing a listed parent place should reuse that location’s id only — do not call
 * {@link addCommunityLocation}. Coordinates are coerced with `Number()` for RPC/JSON safety.
 */
export function isWithinPinParentReuseThreshold(
  pinLat: number,
  pinLng: number,
  parentLat: number,
  parentLng: number,
): boolean {
  const a = Number(pinLat);
  const b = Number(pinLng);
  const c = Number(parentLat);
  const d = Number(parentLng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) {
    return false;
  }
  return haversineDistance(a, b, c, d) <= LOCATION_PIN_ADJUST_THRESHOLD_KM;
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
    .is('deleted_at', null)
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

async function fetchRootParentCandidatesForRadius(
  lat: number,
  lng: number,
  excludeLocationId: string | null,
  radiusKm: number,
): Promise<NearbyLocationResult[]> {
  try {
    const { data, error } = await supabase.rpc('search_nearby_root_locations', {
      search_lat: lat,
      search_lng: lng,
      exclude_location_id: excludeLocationId,
      radius_km: radiusKm,
    });

    if (!error && Array.isArray(data) && data.length > 0) {
      return data as NearbyLocationResult[];
    }
    if (error) {
      console.warn('search_nearby_root_locations RPC failed, using client search:', error.message);
    }
  } catch (e) {
    console.warn('search_nearby_root_locations RPC threw:', e);
  }

  return clientSideRootParentSearch(lat, lng, excludeLocationId, radiusKm);
}

/**
 * Top-level locations (no parent) nearest to a point within `PARENT_CANDIDATE_MAX_RADIUS_KM` (~100 mi).
 * Pass `excludeLocationId` to omit one row (e.g. just created). Tries RPC, then client Haversine.
 * Does not return roots beyond `maxRadiusKm`; empty array means caller should skip pick-parent UI.
 */
export async function searchNearbyRootParentCandidates(
  lat: number,
  lng: number,
  excludeLocationId?: string | null,
  maxRadiusKm: number = PARENT_CANDIDATE_MAX_RADIUS_KM,
): Promise<NearbyLocationResult[]> {
  const exclude = excludeLocationId ?? null;
  let rows = await fetchRootParentCandidatesForRadius(lat, lng, exclude, maxRadiusKm);
  const maxR = Number(maxRadiusKm);
  if (Number.isFinite(maxR)) {
    rows = rows.filter(r => Number(r.distance_km) <= maxR);
  }
  return rows.slice(0, 3);
}

async function clientSideRootParentSearch(
  lat: number,
  lng: number,
  excludeLocationId: string | null,
  radiusKm: number,
): Promise<NearbyLocationResult[]> {
  let q = supabase
    .from('locations')
    .select('*')
    .is('deleted_at', null)
    .is('parent_location_id', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (excludeLocationId) {
    q = q.neq('id', excludeLocationId);
  }

  const { data } = await q;

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
      name_similarity: 0,
    }))
    .filter(loc => loc.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, 3);
}

/** Soft-delete a location the current user created (sets deleted_at / deleted_by). */
export async function softDeleteCommunityLocation(locationId: string): Promise<boolean> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (userErr || !uid) return false;

  const { error } = await supabase
    .from('locations')
    .update({ deleted_at: new Date().toISOString(), deleted_by: uid })
    .eq('id', locationId)
    .eq('created_by', uid)
    .is('deleted_at', null);

  if (error) {
    console.error('softDeleteCommunityLocation:', error);
    return false;
  }
  return true;
}

export type LocationCreatorManageState = {
  isCreator: boolean;
  /** True if any non-deleted trip references this location (any owner). */
  hasActiveTripUsage: boolean;
  /**
   * True when the current user is the creator and may edit pin, visibility, or soft-delete.
   * Allowed with zero trips, or only trips owned by the creator; blocked if another user’s trip uses it.
   */
  canManageUnusedOnly: boolean;
};

/** Creator-only RPC: spot management allowed unless another user’s trip references this location. */
export async function fetchLocationCreatorManageState(
  locationId: string,
): Promise<LocationCreatorManageState | null> {
  const { data, error } = await supabase.rpc('location_creator_manage_state', {
    p_location_id: locationId,
  });
  if (error) {
    console.error('fetchLocationCreatorManageState:', error);
    return null;
  }
  let row: Record<string, unknown>;
  if (typeof data === 'string') {
    try {
      row = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (data && typeof data === 'object') {
    row = data as Record<string, unknown>;
  } else {
    return null;
  }
  if (row.error === 'not_found') return null;
  if (row.isCreator !== true) {
    return { isCreator: false, hasActiveTripUsage: false, canManageUnusedOnly: false };
  }
  return {
    isCreator: true,
    hasActiveTripUsage: Boolean(row.hasActiveTripUsage),
    canManageUnusedOnly: Boolean(row.canManageUnusedOnly),
  };
}

export async function updateLocationPin(
  locationId: string,
  latitude: number,
  longitude: number,
): Promise<boolean> {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (userErr || !uid) return false;

  const { error } = await supabase
    .from('locations')
    .update({ latitude: lat, longitude: lng })
    .eq('id', locationId)
    .eq('created_by', uid)
    .is('deleted_at', null);

  if (error) {
    console.error('updateLocationPin:', error);
    return false;
  }
  return true;
}

export async function setLocationPublic(locationId: string, isPublic: boolean): Promise<boolean> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (userErr || !uid) return false;

  const { error } = await supabase
    .from('locations')
    .update({ is_public: isPublic })
    .eq('id', locationId)
    .eq('created_by', uid)
    .is('deleted_at', null);

  if (error) {
    console.error('setLocationPublic:', error);
    return false;
  }
  return true;
}

/** Set parent for a location row (RLS: typically only rows the user created). */
export async function setLocationParent(childId: string, parentId: string | null): Promise<boolean> {
  const { error } = await supabase
    .from('locations')
    .update({ parent_location_id: parentId })
    .eq('id', childId)
    .is('deleted_at', null);

  if (error) {
    console.error('setLocationParent:', error);
    return false;
  }
  return true;
}

export async function addCommunityLocation(
  name: string,
  type: LocationType,
  latitude: number,
  longitude: number,
  userId: string,
  isPublic: boolean = true,
  parentLocationId?: string | null,
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
      parent_location_id: parentLocationId ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding community location:', error);
    return null;
  }

  return data as Location;
}
