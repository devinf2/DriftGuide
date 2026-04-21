import { v4 as uuidv4 } from 'uuid';
import { readAsStringAsync } from 'expo-file-system/legacy';
import {
  parseProfileAlbumDateForRpc,
  type ProfileAlbumHubRpcFilters,
} from '@/src/services/sync';
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
  // `tripId` omitted = whole library (e.g. journal tab). Trip screen always passes `{ tripId }`.
  console.log('[fetchPhotos] photos table', {
    userId,
    scope: options.tripId != null ? 'single_trip' : 'all_user_photos',
    tripId: options.tripId ?? null,
    count: list.length,
  });
  return list;
}

/** Photos for any of the given trips (album rows). Empty `tripIds` returns []. */
export async function fetchPhotosForTripIds(userId: string, tripIds: string[]): Promise<Photo[]> {
  if (tripIds.length === 0) return [];

  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .eq('user_id', userId)
    .in('trip_id', tripIds)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[fetchPhotosForTripIds] query failed', { userId, tripIds: tripIds.length, error });
    throw error;
  }
  const list = (data as Photo[]) || [];
  console.log('[fetchPhotosForTripIds] photos table', { userId, count: list.length });
  return list;
}

/**
 * Album rows for the given trips visible to the signed-in user (RLS: own rows, shared-session peers,
 * and trip photo visibility rules). No `user_id` filter — peers' trip photos are included when allowed.
 */
export async function fetchPhotosVisibleForTripIds(tripIds: string[]): Promise<Photo[]> {
  if (tripIds.length === 0) return [];

  const { data, error } = await supabase
    .from('photos')
    .select('*')
    .in('trip_id', tripIds)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[fetchPhotosVisibleForTripIds] query failed', { tripIds: tripIds.length, error });
    throw error;
  }
  const list = (data as Photo[]) || [];
  console.log('[fetchPhotosVisibleForTripIds] photos table', { count: list.length });
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

function albumPhotoFiltersUseRpc(f: ProfileAlbumHubRpcFilters): boolean {
  return (
    f.locationIds.length > 0 ||
    f.species.length > 0 ||
    f.flyPatterns.length > 0 ||
    parseProfileAlbumDateForRpc(f.dateFrom) != null ||
    parseProfileAlbumDateForRpc(f.dateTo) != null
  );
}

async function hydratePhotosWithTrip(idsInOrder: string[]): Promise<PhotoWithTrip[]> {
  if (idsInOrder.length === 0) return [];
  const { data, error } = await supabase
    .from('photos')
    .select('*, trip:trips(location_id, location:locations(id, name))')
    .in('id', idsInOrder);
  if (error) {
    console.warn('[hydratePhotosWithTrip] query failed', { count: idsInOrder.length, error });
    throw error;
  }
  const rows = (data as PhotoWithTrip[]) || [];
  const pos = new Map(idsInOrder.map((id, i) => [id, i] as const));
  return [...rows].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
}

/** Paginated profile album (newest first). Uses inclusive `range` — request `limit` rows. */
export async function fetchPhotosWithTripPage(
  userId: string,
  options: { limit: number; offset: number; filters?: ProfileAlbumHubRpcFilters | null },
): Promise<PhotoWithTrip[]> {
  const { limit, offset, filters } = options;
  if (limit <= 0) return [];

  if (filters && albumPhotoFiltersUseRpc(filters)) {
    const { data, error } = await supabase.rpc('profile_album_photos_page', {
      p_album_user_id: userId,
      p_limit: limit,
      p_offset: offset,
      p_location_ids: filters.locationIds.length ? filters.locationIds : null,
      p_date_from: parseProfileAlbumDateForRpc(filters.dateFrom),
      p_date_to: parseProfileAlbumDateForRpc(filters.dateTo),
      p_species: filters.species.length ? filters.species.map((s) => s.trim()) : null,
      p_fly_patterns: filters.flyPatterns.length ? filters.flyPatterns.map((s) => s.trim()) : null,
    });
    if (error) {
      console.warn('[fetchPhotosWithTripPage] rpc failed', { userId, offset, limit, error });
      throw error;
    }
    const bare = (data as Photo[]) || [];
    const ids = bare.map((p) => p.id);
    return hydratePhotosWithTrip(ids);
  }

  const to = offset + limit - 1;
  const { data, error } = await supabase
    .from('photos')
    .select('*, trip:trips(location_id, location:locations(id, name))')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, to);

  if (error) {
    console.warn('[fetchPhotosWithTripPage] query failed', { userId, offset, limit, error });
    throw error;
  }
  const list = (data as PhotoWithTrip[]) || [];
  return list;
}

/** Album rows for the given trips (with trip join), scoped to `userId` (your uploads on those trips). */
export async function fetchPhotosWithTripForTripIds(
  userId: string,
  tripIds: string[],
): Promise<PhotoWithTrip[]> {
  if (tripIds.length === 0) return [];

  const { data, error } = await supabase
    .from('photos')
    .select('*, trip:trips(location_id, location:locations(id, name))')
    .eq('user_id', userId)
    .in('trip_id', tripIds)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[fetchPhotosWithTripForTripIds] query failed', { userId, tripIds: tripIds.length, error });
    throw error;
  }
  return (data as PhotoWithTrip[]) || [];
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
  /** When set, row is linked to catches.id (same as catch trip_events id). Requires catch row in DB before insert. */
  catchId?: string | null;
  /** Sort order within the same catch (default 0). */
  displayOrder?: number;
}

/** Thrown when photo is queued for offline upload; UI can show "Saved locally; will upload when online". */
export class PhotoQueuedOfflineError extends Error {
  constructor() {
    super('Photo saved locally; will upload when online.');
    this.name = 'PhotoQueuedOfflineError';
  }
}

/** After a failed upload/insert we queued the file for retry — use for friendlier UI than raw network errors. */
export class PhotoPendingRetryError extends Error {
  constructor(readonly causeError?: unknown) {
    super('Photo saved on device; upload will retry automatically.');
    this.name = 'PhotoPendingRetryError';
  }
}

async function tryEnqueuePhotoAfterUploadFailure(options: AddPhotoOptions): Promise<boolean> {
  const { catchId, tripId, userId, uri } = options;
  if (!userId?.trim() || !uri?.trim()) return false;
  const pendingType = catchId ? 'catch' : 'trip';
  if (pendingType === 'catch' && (!catchId || !tripId)) return false;
  try {
    const { savePendingPhoto, buildPendingFromAddPhotoOptions } = await import('./pendingPhotoStorage');
    await savePendingPhoto({
      ...buildPendingFromAddPhotoOptions(options, pendingType, catchId ?? undefined),
    });
    return true;
  } catch (e) {
    console.warn('[addPhoto] enqueue-after-failure skipped', e);
    return false;
  }
}

export async function addPhoto(
  options: AddPhotoOptions,
  opts?: { isOnline?: boolean; skipEnqueueOnFailure?: boolean },
): Promise<Photo> {
  const {
    userId,
    tripId,
    uri,
    caption,
    species,
    fly_pattern,
    fly_size,
    fly_color,
    fly_id,
    captured_at,
    catchId,
    displayOrder,
  } = options;
  const isOnline = opts?.isOnline !== false;
  const skipEnqueueOnFailure = opts?.skipEnqueueOnFailure === true;

  if (!isOnline) {
    const { savePendingPhoto, buildPendingFromAddPhotoOptions } = await import('./pendingPhotoStorage');
    const pendingType = catchId ? 'catch' : 'trip';
    await savePendingPhoto({
      ...buildPendingFromAddPhotoOptions(options, pendingType, catchId ?? undefined),
    });
    throw new PhotoQueuedOfflineError();
  }

  const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `photos/${userId}/${uuidv4()}.${ext}`;

  console.log('[addPhoto] start', { userId, tripId, path });

  try {
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
      catch_id: catchId ?? null,
      display_order: displayOrder ?? 0,
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
      console.warn('[addPhoto] photos table insert failed', {
        error: insertError,
        code: insertError.code,
        message: insertError.message,
      });
      throw insertError;
    }
    console.log('[addPhoto] photos row created', { id: (row as Photo)?.id });
    return row as Photo;
  } catch (err) {
    if (!skipEnqueueOnFailure) {
      const ok = await tryEnqueuePhotoAfterUploadFailure(options);
      if (ok) {
        throw new PhotoPendingRetryError(err);
      }
    }
    throw err;
  }
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

/** Remove one album row for a catch by public URL (e.g. user removed a photo in edit). */
export async function deleteCatchPhotoByUrl(userId: string, catchId: string, photoUrl: string): Promise<void> {
  const { error } = await supabase
    .from('photos')
    .delete()
    .eq('user_id', userId)
    .eq('catch_id', catchId)
    .eq('url', photoUrl);
  if (error) throw error;
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

/**
 * Upload a local file to Supabase Storage and return the public URL.
 * Does NOT insert a row into the photos table (caller handles that via RPC or direct insert).
 */
export async function uploadPhotoToStorage(
  userId: string,
  uri: string,
): Promise<{ path: string; url: string }> {
  const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `photos/${userId}/${uuidv4()}.${ext}`;
  const body = await readFileAsArrayBuffer(uri);
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType: getMimeType(ext), upsert: false });
  if (uploadError) throw uploadError;
  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path);
  return { path: uploadData.path, url: publicUrlData.publicUrl };
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

function isProfileAvatarObjectPath(userId: string, storagePath: string): boolean {
  return storagePath.startsWith(`photos/${userId}/profile-`);
}

/** Upload a new profile image, set profiles.avatar_url, and remove the previous profile file when safe. */
export async function uploadProfileAvatar(
  userId: string,
  uri: string,
  options?: { previousAvatarUrl?: string | null },
): Promise<string> {
  const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `photos/${userId}/profile-${uuidv4()}.${ext}`;

  const body = await readFileAsArrayBuffer(uri);
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, {
      contentType: getMimeType(ext),
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(uploadData.path);
  const url = publicUrlData.publicUrl;

  const prev = options?.previousAvatarUrl;
  if (prev) {
    const oldPath = urlToStoragePath(prev);
    if (oldPath && isProfileAvatarObjectPath(userId, oldPath)) {
      await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
    }
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_url: url })
    .eq('id', userId);

  if (updateError) throw updateError;
  return url;
}

/** Clear avatar in DB and remove the profile object from storage when it matches our path pattern. */
export async function clearProfileAvatar(userId: string, avatarUrl: string | null | undefined): Promise<void> {
  if (avatarUrl) {
    const oldPath = urlToStoragePath(avatarUrl);
    if (oldPath && isProfileAvatarObjectPath(userId, oldPath)) {
      await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
    }
  }

  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
  if (error) throw error;
}
