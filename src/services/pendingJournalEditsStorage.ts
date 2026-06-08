import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Trip, TripEvent } from '@/src/types';

const PENDING_JOURNAL_EDITS_KEY = 'pending_journal_edits';

export type JournalEditMode = 'upsert' | 'delete';

/**
 * Queued offline edits to an already-uploaded (journal) trip.
 *
 * `ops` is keyed by event id with last-write-wins semantics: if the same event is touched
 * multiple times while offline, only the latest mode is kept (a later delete supersedes an
 * earlier upsert, and vice-versa). `events` is the latest full local event set for the trip,
 * used as the source of truth for upserts and for recomputing total_fish on flush.
 */
export type PendingJournalEdits = {
  trip: Trip;
  events: TripEvent[];
  ops: Record<string, JournalEditMode>;
  queuedAt: string;
};

async function readAll(): Promise<Record<string, PendingJournalEdits>> {
  const raw = await AsyncStorage.getItem(PENDING_JOURNAL_EDITS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, PendingJournalEdits>;
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, PendingJournalEdits>): Promise<void> {
  await AsyncStorage.setItem(PENDING_JOURNAL_EDITS_KEY, JSON.stringify(data));
}

/**
 * Queue one or more event ops against a journal trip and snapshot the latest full event set.
 * Ops merge into any existing queue for the trip with last-write-wins per event id.
 */
export async function enqueueJournalEdits(
  trip: Trip,
  ops: { eventId: string; mode: JournalEditMode }[],
  events: TripEvent[],
): Promise<void> {
  if (ops.length === 0) return;
  const data = await readAll();
  const prev = data[trip.id];
  const mergedOps: Record<string, JournalEditMode> = { ...(prev?.ops ?? {}) };
  for (const { eventId, mode } of ops) {
    mergedOps[eventId] = mode;
  }
  data[trip.id] = {
    trip,
    events,
    ops: mergedOps,
    queuedAt: new Date().toISOString(),
  };
  await writeAll(data);
}

export async function getPendingJournalEdits(): Promise<Record<string, PendingJournalEdits>> {
  return readAll();
}

export async function hasPendingJournalEdits(tripId: string): Promise<boolean> {
  const data = await readAll();
  return data[tripId] != null && Object.keys(data[tripId].ops).length > 0;
}

/** Replace the remaining ops after a flush attempt; clears the trip entry when none remain. */
export async function setRemainingJournalOps(
  tripId: string,
  ops: Record<string, JournalEditMode>,
): Promise<void> {
  const data = await readAll();
  const prev = data[tripId];
  if (!prev) return;
  if (Object.keys(ops).length === 0) {
    delete data[tripId];
  } else {
    data[tripId] = { ...prev, ops };
  }
  await writeAll(data);
}

export async function removePendingJournalEdits(tripId: string): Promise<void> {
  const data = await readAll();
  if (!data[tripId]) return;
  delete data[tripId];
  await writeAll(data);
}
