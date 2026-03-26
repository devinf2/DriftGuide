import { supabase } from '@/src/services/supabase';
import type { AccessPoint, AccessPointStatus } from '@/src/types';

function rowToAccessPoint(row: Record<string, unknown>): AccessPoint {
  return {
    id: String(row.id),
    location_id: String(row.location_id),
    name: String(row.name),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    status: row.status as AccessPointStatus,
    created_by: row.created_by != null ? String(row.created_by) : null,
    created_at: String(row.created_at),
  };
}

/** Approved pins for maps (RLS returns approved + own pending; filter client-side for "public map" if needed). */
export async function fetchApprovedAccessPointsForLocation(locationId: string): Promise<AccessPoint[]> {
  const { data, error } = await supabase
    .from('access_points')
    .select('*')
    .eq('location_id', locationId)
    .eq('status', 'approved')
    .order('name');

  if (error || !data) return [];
  return data.map((r) => rowToAccessPoint(r as Record<string, unknown>));
}

/** Picker: approved + caller's pending for this location. */
export async function fetchAccessPointsForPicker(locationId: string): Promise<AccessPoint[]> {
  const { data, error } = await supabase
    .from('access_points')
    .select('*')
    .eq('location_id', locationId)
    .order('name');

  if (error || !data) return [];
  return data.map((r) => rowToAccessPoint(r as Record<string, unknown>));
}

export async function createAccessPoint(params: {
  locationId: string;
  name: string;
  latitude: number;
  longitude: number;
  userId: string;
}): Promise<AccessPoint | null> {
  const { data, error } = await supabase
    .from('access_points')
    .insert({
      location_id: params.locationId,
      name: params.name.trim(),
      latitude: params.latitude,
      longitude: params.longitude,
      created_by: params.userId,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('[createAccessPoint]', error);
    return null;
  }
  return rowToAccessPoint(data as Record<string, unknown>);
}
