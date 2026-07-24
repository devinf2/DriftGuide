import { supabase } from './supabase';
import { uploadPhotoToStorage } from './photoService';
import { haversineDistance } from './locationService';
import { Business, BusinessCategory, BusinessHours, BusinessPhoto, BusinessStatus } from '@/src/types';

/**
 * Business directory service. Businesses are commercial listings (outfitters,
 * lodges, fly shops) kept separate from the fishing-spot `locations` catalog.
 * Write path mirrors `addCommunityLocation`: user submissions land as `pending`
 * (enforced by a DB trigger) until an admin verifies them.
 */

export interface NewBusinessInput {
  name: string;
  category: BusinessCategory;
  latitude: number;
  longitude: number;
  location_id?: string | null;
  address?: string | null;
  state?: string | null;
  description?: string | null;
  website_url?: string | null;
  phone?: string | null;
  email?: string | null;
  hours?: BusinessHours | null;
}

/** Insert a community-submitted business. Returns the row (status forced to 'pending' by trigger). */
export async function addCommunityBusiness(
  input: NewBusinessInput,
  userId: string,
): Promise<Business | null> {
  const lat = Number(input.latitude);
  const lng = Number(input.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.error('addCommunityBusiness: invalid coordinates', input);
    return null;
  }

  const { data, error } = await supabase
    .from('businesses')
    .insert({
      name: input.name.trim(),
      category: input.category,
      latitude: lat,
      longitude: lng,
      location_id: input.location_id ?? null,
      address: input.address?.trim() || null,
      state: input.state?.trim() || null,
      description: input.description?.trim() || null,
      website_url: normalizeUrl(input.website_url),
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      hours: input.hours ?? {},
      created_by: userId,
      status: 'pending',
      usage_count: 0,
      metadata: {},
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding community business:', error);
    return null;
  }
  return data as Business;
}

/** All businesses visible to the viewer (RLS: verified, own, or admin). */
export async function fetchBusinesses(): Promise<Business[]> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .is('deleted_at', null)
    .order('name');

  if (error) {
    console.warn('[fetchBusinesses] failed', error);
    return [];
  }
  return (data as Business[]) ?? [];
}

/**
 * Admin-only: businesses awaiting review (status 'pending'). RLS returns pending
 * rows only to admins (and the submitter), so a non-admin caller gets just their
 * own — the home bell that consumes this is already admin-gated. Powers the
 * "new shop to review" notification list.
 */
export async function fetchPendingBusinesses(): Promise<Business[]> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('status', 'pending')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[fetchPendingBusinesses] failed', error);
    return [];
  }
  return (data as Business[]) ?? [];
}

/** Businesses within a lat/lng bounding box (viewport). */
export async function fetchBusinessesInBounds(bounds: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): Promise<Business[]> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .is('deleted_at', null)
    .gte('latitude', bounds.minLat)
    .lte('latitude', bounds.maxLat)
    .gte('longitude', bounds.minLng)
    .lte('longitude', bounds.maxLng)
    .order('name');

  if (error) {
    console.warn('[fetchBusinessesInBounds] failed', error);
    return [];
  }
  return (data as Business[]) ?? [];
}

export interface BusinessNearby extends Business {
  distance_km: number;
}

/** Verified businesses explicitly tagged to any of these waters (self + parent + sections). */
export async function fetchBusinessesForLocation(locationIds: string | string[]): Promise<Business[]> {
  const ids = (Array.isArray(locationIds) ? locationIds : [locationIds]).filter(Boolean);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .in('location_id', ids)
    .eq('status', 'verified')
    .is('deleted_at', null)
    .order('name');
  if (error) {
    console.warn('[fetchBusinessesForLocation] failed', { ids, error });
    return [];
  }
  return (data as Business[]) ?? [];
}

/**
 * Verified businesses near a point (e.g. the selected water), nearest first.
 * Used by the Report's "Local shops" — outfitters tied to a location by proximity.
 */
export async function fetchBusinessesNearPoint(
  lat: number,
  lng: number,
  radiusKm = 40,
  limit = 8,
): Promise<BusinessNearby[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  // ~111km per degree latitude; widen longitude by latitude to keep the box roughly square.
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);

  const rows = await fetchBusinessesInBounds({
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLng: lng - dLng,
    maxLng: lng + dLng,
  });

  return rows
    .filter((b) => b.status === 'verified')
    .map((b) => ({ ...b, distance_km: haversineDistance(lat, lng, b.latitude, b.longitude) }))
    .filter((b) => b.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, limit);
}

export async function getBusinessById(id: string): Promise<Business | null> {
  const { data, error } = await supabase.from('businesses').select('*').eq('id', id).single();
  if (error) {
    console.warn('[getBusinessById] failed', { id, error });
    return null;
  }
  return data as Business;
}

export async function fetchBusinessPhotos(businessId: string): Promise<BusinessPhoto[]> {
  const { data, error } = await supabase
    .from('business_photos')
    .select('*')
    .eq('business_id', businessId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[fetchBusinessPhotos] failed', { businessId, error });
    return [];
  }
  return (data as BusinessPhoto[]) ?? [];
}

/** Upload a gallery photo (reuses the `photos` bucket) and insert the row. */
export async function addBusinessPhoto(
  businessId: string,
  userId: string,
  uri: string,
  sortOrder = 0,
): Promise<BusinessPhoto | null> {
  const { url } = await uploadPhotoToStorage(userId, uri);
  const { data, error } = await supabase
    .from('business_photos')
    .insert({ business_id: businessId, photo_url: url, sort_order: sortOrder, created_by: userId })
    .select()
    .single();

  if (error) {
    console.error('[addBusinessPhoto] insert failed', { businessId, error });
    return null;
  }
  return data as BusinessPhoto;
}

/** Owner (or admin) edits a business. RLS enforces authorization. */
export async function updateBusiness(
  id: string,
  patch: Partial<NewBusinessInput> & { logo_url?: string | null; cover_url?: string | null },
): Promise<boolean> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.category !== undefined) payload.category = patch.category;
  if (patch.location_id !== undefined) payload.location_id = patch.location_id ?? null;
  if (patch.address !== undefined) payload.address = patch.address?.trim() || null;
  if (patch.state !== undefined) payload.state = patch.state?.trim() || null;
  if (patch.description !== undefined) payload.description = patch.description?.trim() || null;
  if (patch.website_url !== undefined) payload.website_url = normalizeUrl(patch.website_url);
  if (patch.phone !== undefined) payload.phone = patch.phone?.trim() || null;
  if (patch.email !== undefined) payload.email = patch.email?.trim() || null;
  if (patch.hours !== undefined) payload.hours = patch.hours ?? {};
  if (patch.logo_url !== undefined) payload.logo_url = patch.logo_url;
  if (patch.cover_url !== undefined) payload.cover_url = patch.cover_url;

  const { error } = await supabase.from('businesses').update(payload).eq('id', id);
  if (error) {
    console.error('[updateBusiness] failed', { id, error });
    return false;
  }
  return true;
}

/** Soft-delete (owner or admin per RLS). */
export async function softDeleteBusiness(id: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('businesses')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', id);
  if (error) {
    console.error('[softDeleteBusiness] failed', { id, error });
    return false;
  }
  return true;
}

/** Admin-only moderation: flip a submission's status (RLS enforces is_admin). */
export async function setBusinessStatus(id: string, status: BusinessStatus): Promise<boolean> {
  const { error } = await supabase.from('businesses').update({ status }).eq('id', id);
  if (error) {
    console.error('[setBusinessStatus] failed', { id, status, error });
    return false;
  }
  return true;
}

/** Coerce user-entered URLs to include a scheme so Linking can open them. */
function normalizeUrl(url?: string | null): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
