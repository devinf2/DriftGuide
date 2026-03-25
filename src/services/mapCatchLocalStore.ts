import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CatchData, CatchRow, Trip, TripEvent } from '@/src/types';
import { upsertCatchEventToCloud } from '@/src/services/sync';

const CACHED_CATCHES_KEY = '@driftguide/cached_catches';
const PENDING_CATCHES_KEY = '@driftguide/pending_catches';

/** Minimal catch fields for map pins + offline cache. */
export type CachedCatchPin = {
  id: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  species: string | null;
};

export type CachedCatchesPayload = {
  updatedAt: string;
  items: CachedCatchPin[];
};

export type PendingCatchPayload = {
  trip: Trip;
  event: TripEvent;
  allEvents: TripEvent[];
};

function catchRowToPin(row: CatchRow): CachedCatchPin | null {
  if (row.latitude == null || row.longitude == null) return null;
  return {
    id: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    timestamp: row.timestamp,
    species: row.species ?? null,
  };
}

export function cachedPinFromCatchEvent(e: TripEvent): CachedCatchPin | null {
  if (e.event_type !== 'catch' || e.latitude == null || e.longitude == null) return null;
  const d = e.data as CatchData;
  return {
    id: e.id,
    latitude: e.latitude,
    longitude: e.longitude,
    timestamp: e.timestamp,
    species: d.species ?? null,
  };
}

/** Merge pins into `cached_catches` by id (incoming wins). */
export async function mergeCachedPins(pins: CachedCatchPin[]): Promise<void> {
  if (pins.length === 0) return;
  const existing = await getCachedCatchesPayload();
  const byId = new Map<string, CachedCatchPin>();
  for (const x of existing?.items ?? []) {
    byId.set(x.id, x);
  }
  for (const x of pins) {
    byId.set(x.id, x);
  }
  const payload: CachedCatchesPayload = {
    updatedAt: new Date().toISOString(),
    items: Array.from(byId.values()),
  };
  await AsyncStorage.setItem(CACHED_CATCHES_KEY, JSON.stringify(payload));
}

export async function getCachedCatchesPayload(): Promise<CachedCatchesPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHED_CATCHES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCatchesPayload;
    if (!parsed?.items || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getCachedCatchPins(): Promise<CachedCatchPin[]> {
  const p = await getCachedCatchesPayload();
  return p?.items ?? [];
}

/** Merge server rows into cache (by id, incoming wins). */
export async function mergeCachedCatchesFromRows(rows: CatchRow[]): Promise<void> {
  const incoming = rows.map(catchRowToPin).filter((x): x is CachedCatchPin => x != null);
  const existing = await getCachedCatchesPayload();
  const byId = new Map<string, CachedCatchPin>();
  for (const x of existing?.items ?? []) {
    byId.set(x.id, x);
  }
  for (const x of incoming) {
    byId.set(x.id, x);
  }
  const payload: CachedCatchesPayload = {
    updatedAt: new Date().toISOString(),
    items: Array.from(byId.values()),
  };
  await AsyncStorage.setItem(CACHED_CATCHES_KEY, JSON.stringify(payload));
}

async function readPending(): Promise<PendingCatchPayload[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CATCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingCatchPayload[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writePending(items: PendingCatchPayload[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_CATCHES_KEY, JSON.stringify(items));
}

/** Enqueue or replace by event.id (dedupe). */
export async function enqueuePendingCatch(payload: PendingCatchPayload): Promise<void> {
  const list = await readPending();
  const next = list.filter((p) => p.event.id !== payload.event.id);
  next.push(payload);
  await writePending(next);
}

export async function removePendingCatchByEventId(eventId: string): Promise<void> {
  const list = await readPending();
  await writePending(list.filter((p) => p.event.id !== eventId));
}

/** Upload pending catch payloads; removes each on success. */
export async function flushPendingCatches(): Promise<void> {
  const list = await readPending();
  if (list.length === 0) return;

  const remaining: PendingCatchPayload[] = [];
  for (const p of list) {
    const ok = await upsertCatchEventToCloud(p.trip, p.event, p.allEvents);
    if (!ok) remaining.push(p);
  }
  await writePending(remaining);
}
