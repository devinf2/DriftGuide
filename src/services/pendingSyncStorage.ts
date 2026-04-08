import AsyncStorage from '@react-native-async-storage/async-storage';
import { Trip, TripEvent } from '@/src/types';

const PENDING_SYNC_KEY = 'pending_sync_trips';

export type PendingTripPayload = { trip: Trip; events: TripEvent[] };

export async function savePendingTrip(
  tripId: string,
  trip: Trip,
  events: TripEvent[],
): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_SYNC_KEY);
  const data: Record<string, PendingTripPayload> = raw ? JSON.parse(raw) : {};
  data[tripId] = { trip, events };
  await AsyncStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(data));
}

export async function getPendingTrips(): Promise<Record<string, PendingTripPayload>> {
  const raw = await AsyncStorage.getItem(PENDING_SYNC_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
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
