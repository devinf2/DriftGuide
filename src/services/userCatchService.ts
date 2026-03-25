import { supabase } from '@/src/services/supabase';
import type { BoundingBox } from '@/src/types/boundingBox';
import type { UserCatchRow } from '@/src/types/userCatch';
import {
  appendPendingUserCatch,
  loadPendingUserCatches,
  mergeUserCatchesIntoStorage,
  removePendingUserCatchIds,
} from '@/src/services/userCatchLocal';

function rowToRemote(userId: string, row: UserCatchRow) {
  return {
    id: row.id,
    user_id: userId,
    latitude: row.latitude,
    longitude: row.longitude,
    timestamp: row.timestamp,
  };
}

/**
 * Range query on lat/lng using the canonical BoundingBox (same object as map / offline).
 */
export async function fetchUserCatchesInBoundingBox(
  userId: string,
  bbox: BoundingBox,
): Promise<UserCatchRow[]> {
  const { data, error } = await supabase
    .from('user_catches')
    .select('id, latitude, longitude, timestamp, created_at')
    .eq('user_id', userId)
    .gte('latitude', bbox.sw.lat)
    .lte('latitude', bbox.ne.lat)
    .gte('longitude', bbox.sw.lng)
    .lte('longitude', bbox.ne.lng)
    .order('timestamp', { ascending: false });

  if (error) {
    console.warn('[userCatchService] fetchUserCatchesInBoundingBox', error.message);
    return [];
  }

  return (data ?? []).map((r) => ({
    id: r.id,
    latitude: r.latitude,
    longitude: r.longitude,
    timestamp: r.timestamp,
    created_at: r.created_at ?? undefined,
  }));
}

export async function upsertUserCatchRemote(userId: string, row: UserCatchRow): Promise<Error | null> {
  const payload = rowToRemote(userId, row);
  const { error } = await supabase.from('user_catches').upsert(payload, {
    onConflict: 'id',
    ignoreDuplicates: true,
  });
  return error ? new Error(error.message) : null;
}

/**
 * After local + Fish: merge into AsyncStorage cache; if online, upsert Supabase; else queue pending.
 */
export async function persistUserCatchAfterLocalAdd(input: {
  userId: string;
  id: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  isOnline: boolean;
}): Promise<void> {
  const row: UserCatchRow = {
    id: input.id,
    latitude: input.latitude,
    longitude: input.longitude,
    timestamp: input.timestamp,
  };
  await mergeUserCatchesIntoStorage([row]);

  if (input.isOnline) {
    const err = await upsertUserCatchRemote(input.userId, row);
    if (!err) {
      await removePendingUserCatchIds([input.id]);
      return;
    }
  }

  await appendPendingUserCatch(row);
}

/**
 * On app resume / reconnect: flush pending with idempotent upsert; drop from queue on success.
 */
export async function syncPendingUserCatches(userId: string): Promise<void> {
  const pending = await loadPendingUserCatches();
  if (pending.length === 0) return;

  const done: string[] = [];
  for (const row of pending) {
    const err = await upsertUserCatchRemote(userId, row);
    if (!err) {
      done.push(row.id);
    }
  }
  await removePendingUserCatchIds(done);
}
