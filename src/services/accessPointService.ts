import { supabase } from '@/src/services/supabase';
import type { AccessPoint } from '@/src/types';
import { createLocationWithOutbox } from '@/src/services/locationService';

/**
 * Access points are child `locations` rows (type 'access_point', parent_location_id = the
 * water). They used to live in a separate `access_points` table; this service now maps the
 * unified `locations` model back onto the {@link AccessPoint} shape callers expect.
 *
 * Moderation maps to `is_public`: a public row reads as 'approved', a private one as 'pending'.
 */
function locationRowToAccessPoint(row: Record<string, unknown>): AccessPoint {
  return {
    id: String(row.id),
    location_id: row.parent_location_id != null ? String(row.parent_location_id) : '',
    name: String(row.name),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    status: row.is_public === false ? 'pending' : 'approved',
    created_by: row.created_by != null ? String(row.created_by) : null,
    created_at: row.created_at != null ? String(row.created_at) : '',
  };
}

/** Public access points for a water (child access_point locations that are public). */
export async function fetchApprovedAccessPointsForLocation(locationId: string): Promise<AccessPoint[]> {
  return fetchApprovedAccessPointsForLocations([locationId]);
}

/** Public access points for several waters (e.g. spot + parents + children on the detail map). */
export async function fetchApprovedAccessPointsForLocations(locationIds: string[]): Promise<AccessPoint[]> {
  const unique = [...new Set(locationIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('type', 'access_point')
    .in('parent_location_id', unique)
    .is('deleted_at', null)
    .or('is_public.is.null,is_public.eq.true')
    .order('name');

  if (error || !data) return [];
  return data.map((r) => locationRowToAccessPoint(r as Record<string, unknown>));
}

/** Picker: every access point under a water the caller can see (RLS handles own private rows). */
export async function fetchAccessPointsForPicker(locationId: string): Promise<AccessPoint[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('type', 'access_point')
    .eq('parent_location_id', locationId)
    .is('deleted_at', null)
    .order('name');

  if (error || !data) return [];
  return data.map((r) => locationRowToAccessPoint(r as Record<string, unknown>));
}

/**
 * Create an access point as a child location under `locationId`. Offline-capable — the pin
 * shows immediately and the write queues until reconnect (see {@link createLocationWithOutbox}).
 */
export async function createAccessPoint(params: {
  locationId: string;
  name: string;
  latitude: number;
  longitude: number;
  userId: string;
}): Promise<AccessPoint | null> {
  try {
    const { location } = await createLocationWithOutbox(
      {
        name: params.name.trim(),
        type: 'access_point',
        latitude: params.latitude,
        longitude: params.longitude,
        isPublic: true,
        parentLocationId: params.locationId,
      },
      params.userId,
    );
    return locationRowToAccessPoint(location as unknown as Record<string, unknown>);
  } catch (e) {
    console.error('[createAccessPoint]', e);
    return null;
  }
}
