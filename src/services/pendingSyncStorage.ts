import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WaterClarity } from '@/src/types';
import type { Trip, TripEvent } from '@/src/types';
import type { EventSyncStatus } from '@/src/types/sync';

const PENDING_SYNC_KEY = 'pending_sync_trips';

export type DeferredSurveyFields = {
  rating: number | null;
  user_reported_clarity: WaterClarity | null;
  notes: string | null;
};

export type PendingTripPayload = {
  trip: Trip;
  events: TripEvent[];
  /** When set with deferredSurvey, survey fields are written to Postgres only after events/catches/photos. */
  surveyPendingCloud?: boolean;
  deferredSurvey?: DeferredSurveyFields;
  /** Trip.notes before survey merge; used for intermediate trip upserts when surveyPendingCloud. */
  tripNotesPreSurvey?: string | null;
  eventSyncState?: Record<string, EventSyncStatus>;
};

function mergeEventSyncState(
  prev: Record<string, EventSyncStatus> | undefined,
  events: TripEvent[],
): Record<string, EventSyncStatus> {
  const next: Record<string, EventSyncStatus> = { ...prev };
  for (const e of events) {
    if (next[e.id] == null) next[e.id] = 'pending';
  }
  for (const id of Object.keys(next)) {
    if (!events.some((ev) => ev.id === id)) delete next[id];
  }
  return next;
}

export function buildInitialEventSyncState(events: TripEvent[]): Record<string, EventSyncStatus> {
  return mergeEventSyncState(undefined, events);
}

type PendingMeta = Partial<
  Pick<PendingTripPayload, 'surveyPendingCloud' | 'deferredSurvey' | 'tripNotesPreSurvey' | 'eventSyncState'>
> & {
  /** Clear deferred survey metadata (e.g. user skipped survey after a prior submit attempt). */
  omitDeferredSurvey?: boolean;
};

export async function savePendingTrip(
  tripId: string,
  trip: Trip,
  events: TripEvent[],
  meta?: PendingMeta,
): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_SYNC_KEY);
  const data: Record<string, PendingTripPayload> = raw ? JSON.parse(raw) : {};
  const prev = data[tripId];
  const clearDefer = Boolean(meta?.omitDeferredSurvey);
  data[tripId] = {
    trip,
    events,
    surveyPendingCloud: clearDefer ? false : (meta?.surveyPendingCloud ?? prev?.surveyPendingCloud),
    deferredSurvey: clearDefer ? undefined : (meta?.deferredSurvey ?? prev?.deferredSurvey),
    tripNotesPreSurvey: clearDefer ? undefined : (meta?.tripNotesPreSurvey ?? prev?.tripNotesPreSurvey),
    eventSyncState:
      meta?.eventSyncState !== undefined
        ? meta.eventSyncState
        : mergeEventSyncState(prev?.eventSyncState, events),
  };
  await AsyncStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(data));
}

export async function patchPendingTripPayload(
  tripId: string,
  patch: Partial<PendingTripPayload>,
): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_SYNC_KEY);
  if (!raw) return;
  const data: Record<string, PendingTripPayload> = JSON.parse(raw);
  const prev = data[tripId];
  if (!prev) return;
  data[tripId] = { ...prev, ...patch };
  await AsyncStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(data));
}

export async function getPendingTrips(): Promise<Record<string, PendingTripPayload>> {
  const raw = await AsyncStorage.getItem(PENDING_SYNC_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, PendingTripPayload>;
  } catch {
    return {};
  }
}

export async function removePendingTrip(tripId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_SYNC_KEY);
  if (!raw) return;
  const data: Record<string, PendingTripPayload> = JSON.parse(raw);
  delete data[tripId];
  await AsyncStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(data));
}

export async function clearAllPendingSyncTrips(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_SYNC_KEY);
}
