import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationType } from '@/src/types';

const KEY = 'driftguide_pending_location_ops_v1';

export type PendingLocationCreateInput = {
  name: string;
  type: LocationType;
  latitude: number;
  longitude: number;
  isPublic: boolean;
  /** Server id of the parent water, when it is an already-synced location. */
  parentLocationId?: string | null;
  /** Client id of the parent, when the parent is itself an offline-created pin awaiting sync. */
  parentClientId?: string | null;
};

export type PendingLocationOp = {
  kind: 'create';
  /** Local id used as the optimistic Location.id (e.g. `local_<uuid>`). */
  clientId: string;
  userId: string;
  input: PendingLocationCreateInput;
};

export async function getPendingLocationOps(): Promise<PendingLocationOp[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as PendingLocationOp[];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

export async function setPendingLocationOps(ops: PendingLocationOp[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(ops));
}

export async function enqueuePendingLocationCreate(
  userId: string,
  clientId: string,
  input: PendingLocationCreateInput,
): Promise<void> {
  const ops = await getPendingLocationOps();
  ops.push({ kind: 'create', clientId, userId, input });
  await setPendingLocationOps(ops);
}

export async function removePendingLocationCreate(clientId: string): Promise<void> {
  const ops = await getPendingLocationOps();
  await setPendingLocationOps(ops.filter((o) => o.clientId !== clientId));
}
