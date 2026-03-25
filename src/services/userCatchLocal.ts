import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PendingUserCatch, UserCatchRow } from '@/src/types/userCatch';

const PENDING_KEY = '@driftguide/pending_user_catches';
const MERGED_KEY = '@driftguide/merged_user_catches';

/** Cap merged cache size (single list, not bbox-partitioned). */
export const MERGED_USER_CATCHES_MAX = 500;

function parseRows(raw: string | null): UserCatchRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is UserCatchRow =>
        r &&
        typeof r === 'object' &&
        typeof (r as UserCatchRow).id === 'string' &&
        typeof (r as UserCatchRow).latitude === 'number' &&
        typeof (r as UserCatchRow).longitude === 'number' &&
        typeof (r as UserCatchRow).timestamp === 'string',
    );
  } catch {
    return [];
  }
}

export async function loadPendingUserCatches(): Promise<PendingUserCatch[]> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  return parseRows(raw);
}

export async function savePendingUserCatches(rows: PendingUserCatch[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(rows));
}

export async function appendPendingUserCatch(row: PendingUserCatch): Promise<void> {
  const cur = await loadPendingUserCatches();
  if (cur.some((p) => p.id === row.id)) return;
  await savePendingUserCatches([...cur, row]);
}

export async function removePendingUserCatchIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const set = new Set(ids);
  const cur = await loadPendingUserCatches();
  await savePendingUserCatches(cur.filter((p) => !set.has(p.id)));
}

export async function loadMergedUserCatches(): Promise<UserCatchRow[]> {
  const raw = await AsyncStorage.getItem(MERGED_KEY);
  return parseRows(raw);
}

export async function saveMergedUserCatches(rows: UserCatchRow[]): Promise<void> {
  await AsyncStorage.setItem(MERGED_KEY, JSON.stringify(rows));
}

/** Merge by `id` (newer `timestamp` wins), trim to {@link MERGED_USER_CATCHES_MAX}. */
export async function mergeUserCatchesIntoStorage(incoming: UserCatchRow[]): Promise<UserCatchRow[]> {
  if (incoming.length === 0) {
    return loadMergedUserCatches();
  }
  const existing = await loadMergedUserCatches();
  const byId = new Map<string, UserCatchRow>();
  for (const r of existing) {
    byId.set(r.id, r);
  }
  for (const r of incoming) {
    const prev = byId.get(r.id);
    if (!prev || new Date(r.timestamp).getTime() >= new Date(prev.timestamp).getTime()) {
      byId.set(r.id, { ...r, created_at: r.created_at ?? prev?.created_at });
    }
  }
  const merged = Array.from(byId.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const trimmed = merged.slice(0, MERGED_USER_CATCHES_MAX);
  await saveMergedUserCatches(trimmed);
  return trimmed;
}
