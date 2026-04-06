import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Fly, FlyPresentation } from '@/src/types';

const KEY = 'driftguide_pending_fly_ops_v1';

export type PendingFlyCreateInput = {
  fly_id?: string | null;
  name?: string;
  type?: Fly['type'];
  size?: number | null;
  color?: string | null;
  presentation?: FlyPresentation | null;
  photo_url?: string | null;
  fly_color_id?: string | null;
  fly_size_id?: string | null;
  quantity?: number | null;
};

export type PendingFlyOp =
  | { kind: 'create'; clientBoxId: string; userId: string; input: PendingFlyCreateInput }
  | { kind: 'delete'; userId: string; serverId: string };

export async function getPendingFlyOps(): Promise<PendingFlyOp[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as PendingFlyOp[];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function setPendingFlyOps(ops: PendingFlyOp[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(ops));
}

export async function enqueuePendingFlyCreate(
  userId: string,
  clientBoxId: string,
  input: PendingFlyCreateInput,
): Promise<void> {
  const ops = await getPendingFlyOps();
  ops.push({ kind: 'create', clientBoxId, userId, input });
  await setPendingFlyOps(ops);
}

export async function enqueuePendingFlyDelete(userId: string, serverId: string): Promise<void> {
  const ops = await getPendingFlyOps();
  ops.push({ kind: 'delete', userId, serverId });
  await setPendingFlyOps(ops);
}

export async function setPendingFlyOpsList(ops: PendingFlyOp[]): Promise<void> {
  await setPendingFlyOps(ops);
}

export async function removePendingFlyCreate(clientBoxId: string): Promise<void> {
  const ops = await getPendingFlyOps();
  await setPendingFlyOpsList(ops.filter((o) => o.kind !== 'create' || o.clientBoxId !== clientBoxId));
}

export async function removePendingFlyDelete(serverId: string): Promise<void> {
  const ops = await getPendingFlyOps();
  await setPendingFlyOpsList(ops.filter((o) => o.kind !== 'delete' || o.serverId !== serverId));
}
