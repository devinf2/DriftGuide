import { v4 as uuidv4 } from 'uuid';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { Photo } from '@/src/types';

const BUCKET = 'photos';

/** Read local file (picker URI) and return as ArrayBuffer for upload. fetch(uri) is unreliable on RN. */
async function readFileAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const base64 = await readAsStringAsync(uri, { encoding: 'base64' });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export interface FetchPhotosOptions {
  tripId?: string | null;
}

export async function fetchPhotos(userId: string, options: FetchPhotosOptions = {}): Promise<Photo[]> {
  let q = supabase
    .from('photos')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (options.tripId != null) {
    q = q.eq('trip_id', options.tripId);
  }

  const { data, error } = await q;
  if (error) {
    console.warn('[fetchPhotos] query failed', { userId, tripId: options.tripId, error });
    throw error;
  }
  const list = (data as Photo[]) || [];
  console.log('[fetchPhotos] photos table', { userId, tripId: options.tripId, count: list.length });
  return list;
}

/** Photo with optional trip and location for library + filters */
export interface PhotoWithTrip extends Photo {
  trip?: { id: string; location_id: string | null; location?: { id: string; name: string } | null } | null;
}

export async function fetchPhotosWithTrip(userId: string): Promise<PhotoWithTrip[]> {
  const { data, error } = await supabase
    .from('photos')
    .select('*, trip:trips(location_id, location:locations(id, name))')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[fetchPhotosWithTrip] query failed', { userId, error });
    throw error;
  }
  const list = (data as PhotoWithTrip[]) || [];
  console.log('[fetchPhotosWithTrip] photos table', { userId, count: list.length });
  return list;
}

export interface AddPhotoOptions {
  userId: string;
  tripId?: string | null;
  uri: string;
  caption?: string | null;
  species?: string | null;
  fly_pattern?: string | null;
  fly_size?: string | number | null;
  fly_color?: string | null;
  /** Catalog fly id when current fly has fly_id (e.g. from user fly box). */
  fly_id?: string | null;
  captured_at?: string | null;
}

/** Thrown when photo is queued for offline upload; UI can show "Saved locally; will upload when online". */
export class PhotoQueuedOfflineError extends Error {
  constructor() {
    super('Photo saved locally; will upload when online.');
    this.name = 'PhotoQueuedOfflineError';
  }
}

export async function addPhoto(
  options: AddPhotoOptions,
  opts?: { isOnline?: boolean },
): Promise<Photo> {
  const { userId, tripId, uri, caption, species, fly_pattern, fly_size, fly_color, fly_id, captured_at } = options;
  const isOnline = opts?.isOnline !== false;

  if (!isOnline) {
    const { savePendingPhoto, buildPendingFromAddPhotoOptions } = await import('./pendingPhotoStorage');
    await savePendingPhoto({
      ...buildPendingFromAddPhotoOptions(options, 'trip'),
    });
    throw new PhotoQueuedOfflineError();
  }

  const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `photos/${userId}/${uuidv4()}.${ext}`;

  console.log('[addPhoto] start', { userId, tripId, path });

  const body = await readFileAsArrayBuffer(uri);
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, {
      contentType: getMimeType(ext),
      upsert: false,
    });

  if (uploadError) {
    console.warn('[addPhoto] storage upload failed', { path, error: uploadError });
    throw uploadError;
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path);
  const url = publicUrlData.publicUrl;
  console.log('[addPhoto] storage upload ok', { path, url });

  const flySizeStr = fly_size != null ? String(fly_size) : null;
  const insertPayload = {
    user_id: userId,
    trip_id: tripId ?? null,
    url,
    caption: caption ?? null,
    species: species ?? null,
    fly_pattern: fly_pattern ?? null,
    fly_size: flySizeStr,
    fly_color: fly_color ?? null,
    fly_id: fly_id ?? null,
    captured_at: captured_at ?? null,
  };
  console.log('[addPhoto] inserting into photos table', insertPayload);

  const { data: row, error: insertError } = await supabase
    .from('photos')
    .insert(insertPayload)
    .select()
    .single();

  if (insertError) {
    console.warn('[addPhoto] photos table insert failed', { error: insertError, code: insertError.code, message: insertError.message });
    throw insertError;
  }
  console.log('[addPhoto] photos row created', { id: (row as Photo)?.id });
  return row as Photo;
}

export async function deletePhoto(photoId: string, userId: string): Promise<void> {
  const { data: photo, error: fetchError } = await supabase
    .from('photos')
    .select('url')
    .eq('id', photoId)
    .eq('user_id', userId)
    .single();

  if (fetchError || !photo) throw fetchError || new Error('Photo not found');

  const path = urlToStoragePath(photo.url);
  if (path) await supabase.storage.from(BUCKET).remove([path]);

  const { error: deleteError } = await supabase.from('photos').delete().eq('id', photoId).eq('user_id', userId);
  if (deleteError) throw deleteError;
}

/** Upload a photo for a catch; returns the public URL to store in catch event data. Uses same path as home (photos/{userId}/) so RLS allows it. Does NOT insert into photos table. */
export async function uploadCatchPhoto(userId: string, tripId: string, uri: string): Promise<string> {
  const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `photos/${userId}/${uuidv4()}.${ext}`;

  console.log('[uploadCatchPhoto] start (catch fish photo, storage only)', { userId, tripId, path });

  const body = await readFileAsArrayBuffer(uri);
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, {
      contentType: getMimeType(ext),
      upsert: false,
    });

  if (uploadError) {
    console.warn('[uploadCatchPhoto] storage upload failed', { path, error: uploadError });
    throw uploadError;
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path);
  console.log('[uploadCatchPhoto] done (URL stored in catch event, no photos table row)', { url: publicUrlData.publicUrl });
  return publicUrlData.publicUrl;
}

/** Upload a photo for a fly (fly box); returns the public URL to store in flies.photo_url. */
export async function uploadFlyPhoto(userId: string, uri: string): Promise<string> {
  const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `photos/${userId}/flies/${uuidv4()}.${ext}`;

  const body = await readFileAsArrayBuffer(uri);
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, {
      contentType: getMimeType(ext),
      upsert: false,
    });

  if (uploadError) throw uploadError;
  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path);
  return publicUrlData.publicUrl;
}

function getMimeType(ext: string): string {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

function urlToStoragePath(url: string): string | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
