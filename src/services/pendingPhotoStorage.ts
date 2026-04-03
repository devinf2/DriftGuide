import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import type { CatchData } from '@/src/types';
import { catchDataWithAppendedPhotoUrl } from '@/src/utils/catchPhotos';
import type { AddPhotoOptions } from './photoService';
import { getPendingTrips } from './pendingSyncStorage';

const PENDING_PHOTOS_KEY = 'pending_photos';

export type PendingPhotoType = 'trip' | 'catch';

export interface PendingPhoto {
  id: string;
  type: PendingPhotoType;
  uri: string;
  userId: string;
  tripId: string;
  /** For type 'catch', the trip_events row id to update with photo_url after upload. */
  eventId?: string;
  /** Order within the catch when multiple pending uploads. */
  displayOrder?: number;
  caption?: string | null;
  species?: string | null;
  fly_pattern?: string | null;
  fly_size?: string | number | null;
  fly_color?: string | null;
  fly_id?: string | null;
  captured_at?: string | null;
  createdAt: string;
}

async function getStored(): Promise<PendingPhoto[]> {
  const raw = await AsyncStorage.getItem(PENDING_PHOTOS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function setStored(items: PendingPhoto[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_PHOTOS_KEY, JSON.stringify(items));
}

export function buildPendingFromAddPhotoOptions(
  options: AddPhotoOptions,
  type: PendingPhotoType,
  eventId?: string,
): Omit<PendingPhoto, 'id' | 'createdAt'> {
  return {
    type,
    uri: options.uri,
    userId: options.userId,
    tripId: options.tripId ?? '',
    eventId,
    displayOrder: options.displayOrder,
    caption: options.caption ?? null,
    species: options.species ?? null,
    fly_pattern: options.fly_pattern ?? null,
    fly_size: options.fly_size ?? null,
    fly_color: options.fly_color ?? null,
    fly_id: options.fly_id ?? null,
    captured_at: options.captured_at ?? null,
  };
}

export async function savePendingPhoto(
  payload: Omit<PendingPhoto, 'id' | 'createdAt'>,
): Promise<string> {
  const id = uuidv4();
  const item: PendingPhoto = {
    ...payload,
    id,
    createdAt: new Date().toISOString(),
  };
  const list = await getStored();
  list.push(item);
  await setStored(list);
  return id;
}

export async function getPendingPhotos(): Promise<PendingPhoto[]> {
  return getStored();
}

export async function removePendingPhoto(id: string): Promise<void> {
  const list = await getStored();
  const next = list.filter((p) => p.id !== id);
  await setStored(next);
}

/** Append uploaded photo URL to catch event data in the pending trip payload (multi-photo safe). */
export async function updatePendingTripEventPhotoUrl(
  tripId: string,
  eventId: string,
  photoUrl: string,
): Promise<void> {
  const { savePendingTrip } = await import('./pendingSyncStorage');
  const pending = await getPendingTrips();
  const payload = pending[tripId];
  if (!payload) return;
  const events = payload.events.map((e) =>
    e.id === eventId && e.event_type === 'catch'
      ? {
          ...e,
          data: catchDataWithAppendedPhotoUrl(e.data as CatchData, photoUrl),
        }
      : e,
  );
  await savePendingTrip(tripId, payload.trip, events);
}
