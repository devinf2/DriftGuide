import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { Fly, FlyCatalog, FlyColor, FlySize, FlyPresentation, FlyChangeData, TripEvent } from '@/src/types';
import { resolveFlyNameForSave } from '@/src/utils/flyValidation';
import { isUserFlyPhotoUrl } from '@/src/utils/resolveFlyPhotoUrl';
import type { FlyBoxRemapEntry } from '@/src/utils/flyChangeRemap';
import {
  getBundledFlyCatalog,
  getBundledFlyNameById,
  isBundledCatalogFlyId,
} from '@/src/constants/bundledFlyCatalog';
import {
  getPendingFlyOps,
  setPendingFlyOpsList,
  type PendingFlyCreateInput,
  type PendingFlyOp,
} from '@/src/services/pendingFlyOpsStorage';
import { uploadFlyPhoto } from '@/src/services/photoService';
import { deleteSandboxPendingPhotoFile } from '@/src/services/persistentPhotoUri';

const FLIES_CACHE_PREFIX = 'user_flies_';
const FLY_CATALOG_CACHE_KEY = 'driftguide_fly_catalog_v1';

/** Fetch reference lists for pickers. */
export async function fetchFlyCatalog(): Promise<FlyCatalog[]> {
  const { data, error } = await supabase
    .from('fly_catalog')
    .select('*')
    .order('name');
  if (error) throw error;
  const list = (data ?? []) as FlyCatalog[];
  try {
    await AsyncStorage.setItem(FLY_CATALOG_CACHE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

export async function loadFlyCatalogFromCache(): Promise<FlyCatalog[]> {
  try {
    const raw = await AsyncStorage.getItem(FLY_CATALOG_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FlyCatalog[];
  } catch {
    return [];
  }
}

/** Server catalog when online; cache + bundled fill when offline or empty. */
export async function getFlyCatalogOrBundled(): Promise<FlyCatalog[]> {
  let server: FlyCatalog[] = [];
  try {
    server = await fetchFlyCatalog();
  } catch {
    server = await loadFlyCatalogFromCache();
  }
  const bundled = getBundledFlyCatalog();
  const serverNames = new Set(server.map((c) => c.name.trim().toLowerCase()));
  const fill = bundled.filter((b) => !serverNames.has(b.name.trim().toLowerCase()));
  return [...server, ...fill].sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchFlyColors(): Promise<FlyColor[]> {
  const { data, error } = await supabase
    .from('fly_colors')
    .select('*')
    .order('name');
  if (error) throw error;
  return (data ?? []) as FlyColor[];
}

export async function fetchFlySizes(): Promise<FlySize[]> {
  const { data, error } = await supabase
    .from('fly_sizes')
    .select('*')
    .order('value');
  if (error) throw error;
  return (data ?? []) as FlySize[];
}

/** Map user_fly_box row + joins to Fly display shape. */
function mapFlyBoxRow(r: {
  id: string;
  user_id: string;
  fly_id: string;
  fly_color_id: string | null;
  fly_size_id: string | null;
  quantity?: number;
  photo_url?: string | null;
  fly: FlyCatalog | null;
  fly_color: FlyColor | null;
  fly_size: FlySize | null;
}): Fly {
  const boxPhoto = r.photo_url ?? null;
  return {
    id: r.id,
    user_id: r.user_id,
    name: r.fly?.name ?? '',
    type: r.fly?.type ?? 'fly',
    size: r.fly_size?.value ?? null,
    color: r.fly_color?.name ?? null,
    photo_url: boxPhoto?.trim() || null,
    presentation: r.fly?.presentation ?? null,
    quantity: r.quantity ?? 1,
    fly_id: r.fly_id,
    fly_color_id: r.fly_color_id,
    fly_size_id: r.fly_size_id,
  } as Fly;
}

const USER_FLY_BOX_SELECT_BASE = `
  id,
  user_id,
  fly_id,
  fly_color_id,
  fly_size_id,
  quantity,
  fly:fly_catalog(id, name, type, photo_url, presentation),
  fly_color:fly_colors(id, name),
  fly_size:fly_sizes(id, value)
`;

const USER_FLY_BOX_SELECT_WITH_PHOTO = `${USER_FLY_BOX_SELECT_BASE}, photo_url`;

type UserFlyBoxRow = {
  id: string;
  user_id: string;
  fly_id: string;
  fly_color_id: string | null;
  fly_size_id: string | null;
  quantity?: number;
  photo_url?: string | null;
  fly: FlyCatalog | null;
  fly_color: FlyColor | null;
  fly_size: FlySize | null;
};

function isMissingPhotoUrlColumnError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST204' || /photo_url/i.test(error.message ?? '');
}

/** User's fly box: user_fly_box with joined fly_catalog, fly_colors, fly_sizes. Returns Fly[] for display. */
export async function fetchFlies(userId: string): Promise<Fly[]> {
  let { data, error } = await supabase
    .from('user_fly_box')
    .select(USER_FLY_BOX_SELECT_WITH_PHOTO)
    .eq('user_id', userId);

  if (error && isMissingPhotoUrlColumnError(error)) {
    ({ data, error } = await supabase
      .from('user_fly_box')
      .select(USER_FLY_BOX_SELECT_BASE)
      .eq('user_id', userId));
  }

  if (error) throw error;
  const rows = (data ?? []) as unknown as UserFlyBoxRow[];
  rows.sort((a, b) => (a.fly?.name ?? '').localeCompare(b.fly?.name ?? ''));

  const flies = rows.map(mapFlyBoxRow);
  try {
    await AsyncStorage.setItem(FLIES_CACHE_PREFIX + userId, JSON.stringify(flies));
  } catch {
    // non-blocking
  }
  return flies;
}

function sanitizeCachedFly(fly: Fly): Fly {
  const photo = fly.photo_url?.trim();
  if (photo && !isUserFlyPhotoUrl(photo)) {
    return { ...fly, photo_url: null };
  }
  return fly;
}

/** Read user fly box from local cache (for offline use). */
export async function getFliesFromCache(userId: string): Promise<Fly[]> {
  try {
    const raw = await AsyncStorage.getItem(FLIES_CACHE_PREFIX + userId);
    if (!raw) return [];
    return (JSON.parse(raw) as Fly[]).map(sanitizeCachedFly);
  } catch {
    return [];
  }
}

async function writeFliesCache(userId: string, flies: Fly[]): Promise<void> {
  try {
    await AsyncStorage.setItem(FLIES_CACHE_PREFIX + userId, JSON.stringify(flies));
  } catch {
    /* ignore */
  }
}

export async function appendOptimisticFlyToCache(userId: string, fly: Fly): Promise<void> {
  const list = await getFliesFromCache(userId);
  await writeFliesCache(userId, [...list, fly]);
}

export async function replacePendingFlyInUserCache(
  userId: string,
  clientBoxId: string,
  fly: Fly,
): Promise<void> {
  const list = await getFliesFromCache(userId);
  await writeFliesCache(
    userId,
    list.map((f) => (f.id === clientBoxId ? fly : f)),
  );
}

export async function removeFlyFromUserCache(userId: string, flyId: string): Promise<void> {
  const list = await getFliesFromCache(userId);
  await writeFliesCache(
    userId,
    list.filter((f) => f.id !== flyId),
  );
}

function buildOptimisticFlyFromPendingCreate(
  userId: string,
  clientBoxId: string,
  input: PendingFlyCreateInput,
): Fly {
  const bundledName = input.fly_id ? getBundledFlyNameById(input.fly_id) : null;
  const name = input.name?.trim() || bundledName || 'Fly';
  const bundled = input.fly_id ? getBundledFlyCatalog().find((b) => b.id === input.fly_id) : null;
  return {
    id: clientBoxId,
    user_id: userId,
    name,
    type: input.type ?? 'fly',
    size: input.size ?? null,
    color: input.color ?? null,
    photo_url: input.local_photo_uri ?? input.photo_url ?? null,
    presentation: input.presentation ?? bundled?.presentation ?? null,
    quantity: input.quantity ?? 1,
    fly_id: input.fly_id ?? undefined,
  };
}

async function mergePendingCreatesIntoFlies(userId: string, flies: Fly[]): Promise<Fly[]> {
  const ops = await getPendingFlyOps();
  const pendingCreates = ops.filter(
    (o): o is Extract<PendingFlyOp, { kind: 'create' }> =>
      o.kind === 'create' && o.userId === userId,
  );
  const byId = new Map<string, Fly>();
  for (const f of flies) byId.set(f.id, f);
  for (const op of pendingCreates) {
    if (!byId.has(op.clientBoxId)) {
      byId.set(op.clientBoxId, buildOptimisticFlyFromPendingCreate(userId, op.clientBoxId, op.input));
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Cached flies merged with pending offline creates (optimistic pg_* rows). */
export async function getFliesForUser(userId: string): Promise<Fly[]> {
  const cached = await getFliesFromCache(userId);
  return mergePendingCreatesIntoFlies(userId, cached);
}

/** Try Supabase; on failure return cached + pending flies. */
export async function fetchFliesOrCache(userId: string): Promise<Fly[]> {
  try {
    const server = await fetchFlies(userId);
    const merged = await mergePendingCreatesIntoFlies(userId, server);
    await writeFliesCache(userId, merged);
    return merged;
  } catch {
    return getFliesForUser(userId);
  }
}

function collectPendingBoxIdsFromEvents(events: TripEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.event_type !== 'fly_change') continue;
    const d = e.data as FlyChangeData;
    if (d.user_fly_box_id?.startsWith('pg_')) ids.add(d.user_fly_box_id);
    if (d.user_fly_box_id2?.startsWith('pg_')) ids.add(d.user_fly_box_id2);
  }
  return ids;
}

function pendingCreateInputForServer(input: PendingFlyCreateInput, photo_url: string | null) {
  if (input.fly_id && isBundledCatalogFlyId(input.fly_id)) {
    const name = getBundledFlyNameById(input.fly_id);
    if (!name) throw new Error(`Unknown bundled fly: ${input.fly_id}`);
    const bundled = getBundledFlyCatalog().find((b) => b.id === input.fly_id);
    return {
      name,
      type: 'fly' as const,
      presentation: input.presentation ?? bundled?.presentation ?? null,
      size: input.size ?? null,
      color: input.color ?? null,
      quantity: input.quantity ?? 1,
      photo_url,
    };
  }
  const { local_photo_uri: _local, ...rest } = input;
  return { ...rest, photo_url };
}

async function flushOnePendingFlyCreate(
  op: Extract<PendingFlyOp, { kind: 'create' }>,
): Promise<FlyBoxRemapEntry> {
  const raw = op.input as PendingFlyCreateInput;
  const localPhotoUri = raw.local_photo_uri?.trim() ?? null;
  let photo_url = raw.photo_url ?? null;
  if (localPhotoUri && !photo_url) {
    photo_url = await uploadFlyPhoto(op.userId, localPhotoUri);
  }
  const createInput = pendingCreateInputForServer(raw, photo_url);
  const fly = await createFly(op.userId, createInput);
  await replacePendingFlyInUserCache(op.userId, op.clientBoxId, fly);
  if (localPhotoUri) {
    await deleteSandboxPendingPhotoFile(localPhotoUri);
  }
  return { serverFly: fly, localPhotoUri };
}

/** Flush pending fly creates tied to a trip (or referenced in its events). Returns ID remap map. */
export async function processPendingFlyOpsForTripId(
  tripId: string,
  userId: string,
  events: TripEvent[],
): Promise<Map<string, FlyBoxRemapEntry>> {
  const referencedIds = collectPendingBoxIdsFromEvents(events);
  const remap = new Map<string, FlyBoxRemapEntry>();
  let ops = await getPendingFlyOps();

  while (true) {
    const idx = ops.findIndex(
      (o) =>
        o.kind === 'create' &&
        o.userId === userId &&
        (o.tripId === tripId || referencedIds.has(o.clientBoxId)),
    );
    if (idx === -1) break;
    const op = ops[idx] as Extract<PendingFlyOp, { kind: 'create' }>;
    try {
      const entry = await flushOnePendingFlyCreate(op);
      remap.set(op.clientBoxId, entry);
      ops = ops.filter((_, i) => i !== idx);
      await setPendingFlyOpsList(ops);
    } catch (e) {
      console.warn('[processPendingFlyOpsForTripId] failed for', op.clientBoxId, e);
      break;
    }
  }
  return remap;
}

export async function flushPendingFlyOps(): Promise<void> {
  let ops = await getPendingFlyOps();
  while (ops.length > 0) {
    const op = ops[0];
    try {
      if (op.kind === 'create') {
        await flushOnePendingFlyCreate(op);
      } else {
        await deleteFly(op.serverId);
      }
      ops = ops.slice(1);
      await setPendingFlyOpsList(ops);
    } catch {
      break;
    }
  }
}

/** Resolve color name to fly_color_id; insert color if missing. */
async function ensureFlyColorId(colorName: string | null | undefined): Promise<string | null> {
  if (!colorName?.trim()) return null;
  const { data: existing } = await supabase
    .from('fly_colors')
    .select('id')
    .eq('name', colorName.trim())
    .limit(1)
    .single();
  if (existing) return existing.id;
  const { data: inserted, error } = await supabase
    .from('fly_colors')
    .insert({ name: colorName.trim() })
    .select('id')
    .single();
  if (error) throw error;
  return inserted?.id ?? null;
}

/** Resolve size value to fly_size_id; insert size if missing. */
async function ensureFlySizeId(size: number | null | undefined): Promise<string | null> {
  if (size == null) return null;
  const { data: existing } = await supabase
    .from('fly_sizes')
    .select('id')
    .eq('value', size)
    .limit(1)
    .single();
  if (existing) return existing.id;
  const { data: inserted, error } = await supabase
    .from('fly_sizes')
    .insert({ value: size })
    .select('id')
    .single();
  if (error) throw error;
  return inserted?.id ?? null;
}

/** Ensure catalog has a fly by name+type; return fly_id. Creates if not exists (one pattern per name+type). */
async function ensureCatalogFly(params: {
  name: string;
  type: Fly['type'];
  presentation?: FlyPresentation | null;
  /** Only set on insert for new custom patterns; user uploads go to user_fly_box.photo_url */
  photo_url?: string | null;
}): Promise<string> {
  const { name, type, presentation, photo_url } = params;
  const trimmedName = name.trim() || resolveFlyNameForSave(null, Boolean(photo_url));
  const { data: existing } = await supabase
    .from('fly_catalog')
    .select('id')
    .eq('name', trimmedName)
    .eq('type', type)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    if (presentation != null) {
      await supabase
        .from('fly_catalog')
        .update({ presentation: presentation ?? null })
        .eq('id', existing.id);
    }
    return existing.id;
  }
  const { data: inserted, error } = await supabase
    .from('fly_catalog')
    .insert({
      name: trimmedName,
      type,
      presentation: presentation ?? null,
      photo_url: photo_url ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  if (!inserted?.id) throw new Error('Failed to create fly_catalog entry');
  return inserted.id;
}

export async function createFly(
  userId: string,
  input: {
    /** When adding from catalog, pass fly_id and (optionally) fly_color_id, fly_size_id. */
    fly_id?: string | null;
    /** When creating new pattern, pass name, type, presentation, photo_url; then color/size. */
    name?: string;
    type?: Fly['type'];
    size?: number | null;
    color?: string | null;
    presentation?: FlyPresentation | null;
    photo_url?: string | null;
    fly_color_id?: string | null;
    fly_size_id?: string | null;
    /** How many of this fly; default 1. */
    quantity?: number | null;
  }
): Promise<Fly> {
  let flyId: string;
  let flyColorId: string | null;
  let flySizeId: string | null;

  if (input.fly_id) {
    if (isBundledCatalogFlyId(input.fly_id)) {
      const name = getBundledFlyNameById(input.fly_id);
      if (!name) throw new Error(`Unknown bundled fly: ${input.fly_id}`);
      const bundled = getBundledFlyCatalog().find((b) => b.id === input.fly_id);
      flyId = await ensureCatalogFly({
        name,
        type: input.type ?? 'fly',
        presentation: input.presentation ?? bundled?.presentation ?? null,
      });
    } else {
      flyId = input.fly_id;
    }
    flyColorId = input.fly_color_id ?? (await ensureFlyColorId(input.color));
    flySizeId = input.fly_size_id ?? (await ensureFlySizeId(input.size ?? null));
  } else {
    flyId = await ensureCatalogFly({
      name: resolveFlyNameForSave(input.name, Boolean(input.photo_url)),
      type: input.type ?? 'fly',
      presentation: input.presentation ?? null,
    });
    flyColorId = input.fly_color_id ?? (await ensureFlyColorId(input.color));
    flySizeId = input.fly_size_id ?? (await ensureFlySizeId(input.size ?? null));
  }

  const quantity = Math.max(1, input.quantity ?? 1);
  const boxPhotoUrl = input.photo_url?.trim() || null;
  const baseInsert = {
    user_id: userId,
    fly_id: flyId,
    fly_color_id: flyColorId,
    fly_size_id: flySizeId,
    quantity,
  };

  let insertPayload: Record<string, unknown> =
    boxPhotoUrl != null ? { ...baseInsert, photo_url: boxPhotoUrl } : baseInsert;

  let { data, error } = await supabase
    .from('user_fly_box')
    .insert(insertPayload)
    .select(USER_FLY_BOX_SELECT_WITH_PHOTO)
    .single();

  if (error && isMissingPhotoUrlColumnError(error)) {
    ({ data, error } = await supabase
      .from('user_fly_box')
      .insert(baseInsert)
      .select(USER_FLY_BOX_SELECT_BASE)
      .single());
  }

  if (error) throw error;
  return mapFlyBoxRow(data as unknown as UserFlyBoxRow);
}

export async function updateFly(
  id: string,
  updates: {
    fly_id?: string;
    fly_color_id?: string | null;
    fly_size_id?: string | null;
    /** Resolved from color name when provided. */
    color?: string | null;
    size?: number | null;
    quantity?: number | null;
    /** When editing catalog fly (name/photo/presentation), pass fly_id and catalog fields. */
    name?: string;
    type?: Fly['type'];
    presentation?: FlyPresentation | null;
    photo_url?: string | null;
  }
): Promise<Fly> {
  const { data: entry } = await supabase
    .from('user_fly_box')
    .select('fly_id, user_id')
    .eq('id', id)
    .single();

  if (entry?.fly_id && (updates.name !== undefined || updates.presentation !== undefined || updates.type !== undefined)) {
    await supabase
      .from('fly_catalog')
      .update({
        ...(updates.name !== undefined && { name: updates.name.trim() || resolveFlyNameForSave(null, false) }),
        ...(updates.type !== undefined && { type: updates.type }),
        ...(updates.presentation !== undefined && { presentation: updates.presentation }),
      })
      .eq('id', entry.fly_id);
  }

  const boxUpdate: Record<string, unknown> = {};
  if (updates.fly_id !== undefined) boxUpdate.fly_id = updates.fly_id;
  if (updates.photo_url !== undefined) boxUpdate.photo_url = updates.photo_url;
  if (updates.fly_color_id !== undefined) {
    boxUpdate.fly_color_id = updates.fly_color_id;
  } else if (updates.color !== undefined) {
    boxUpdate.fly_color_id = await ensureFlyColorId(updates.color);
  }
  if (updates.fly_size_id !== undefined) {
    boxUpdate.fly_size_id = updates.fly_size_id;
  } else if (updates.size !== undefined) {
    boxUpdate.fly_size_id = await ensureFlySizeId(updates.size);
  }
  if (updates.quantity !== undefined) {
    boxUpdate.quantity = Math.max(1, updates.quantity ?? 1);
  }

  if (Object.keys(boxUpdate).length === 0) {
    const flies = entry?.user_id ? await fetchFlies(entry.user_id) : [];
    const found = flies.find((f) => f.id === id);
    if (found) return found;
  }

  let { data, error } = await supabase
    .from('user_fly_box')
    .update(boxUpdate)
    .eq('id', id)
    .select(USER_FLY_BOX_SELECT_WITH_PHOTO)
    .single();

  if (error && isMissingPhotoUrlColumnError(error)) {
    const { photo_url: _photoUrl, ...boxUpdateWithoutPhoto } = boxUpdate;
    ({ data, error } = await supabase
      .from('user_fly_box')
      .update(boxUpdateWithoutPhoto)
      .eq('id', id)
      .select(USER_FLY_BOX_SELECT_BASE)
      .single());
  }

  if (error) throw error;
  return mapFlyBoxRow(data as unknown as UserFlyBoxRow);
}

export async function deleteFly(id: string): Promise<void> {
  const { error } = await supabase.from('user_fly_box').delete().eq('id', id);
  if (error) throw error;
}
