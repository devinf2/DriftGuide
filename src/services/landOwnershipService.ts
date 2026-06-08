import { supabase } from './supabase';
import type { LandOwnershipInfo, LandOwnershipType } from '@/src/types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

const VALID_TYPES: LandOwnershipType[] = [
  'private',
  'federal',
  'state',
  'tribal',
  'local',
  'water',
  'unknown',
];

/**
 * Mapbox VectorSource tile template for the land-ownership overlay. The anon key is passed as a
 * query param because native Mapbox can't attach auth headers to tile requests; the `land-tiles`
 * function is `verify_jwt = false` and read-only. `{z}/{x}/{y}` are filled in by Mapbox.
 */
export const LAND_TILES_URL_TEMPLATE = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/land-tiles/{z}/{x}/{y}?apikey=${SUPABASE_ANON_KEY}`
  : '';

/** Phase-2 parcels template (same endpoint, `layer=parcels`; renders at z16+). */
export const LAND_PARCEL_TILES_URL_TEMPLATE = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/land-tiles/{z}/{x}/{y}?layer=parcels&apikey=${SUPABASE_ANON_KEY}`
  : '';

/** Source-layer ids must match the names passed to ST_AsMVT in the SQL functions. */
export const LAND_OWNERSHIP_SOURCE_LAYER = 'land_ownership';
export const LAND_PARCELS_SOURCE_LAYER = 'land_parcels';

function coerceOwnershipType(value: unknown): LandOwnershipType {
  return VALID_TYPES.includes(value as LandOwnershipType)
    ? (value as LandOwnershipType)
    : 'unknown';
}

/**
 * Ownership at a tapped coordinate via the `land_ownership_at_point` RPC (ST_Contains).
 * Returns null when the point is outside any ownership polygon (e.g. outside Utah) or on error.
 */
export async function getLandOwnershipAtPoint(
  lng: number,
  lat: number,
): Promise<LandOwnershipInfo | null> {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  try {
    const { data, error } = await supabase.rpc('land_ownership_at_point', {
      lng: Number(lng),
      lat: Number(lat),
    });
    if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      ownership_type: coerceOwnershipType(row.ownership_type),
      agency: row.agency ?? null,
      owner_name: row.owner_name ?? null,
      access_status:
        row.access_status === 'public' || row.access_status === 'restricted'
          ? row.access_status
          : 'unknown',
      admin_unit: row.admin_unit ?? null,
    };
  } catch {
    return null;
  }
}
