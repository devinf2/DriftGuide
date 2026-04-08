import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  deleteAsync,
  documentDirectory,
  downloadAsync,
  getInfoAsync,
  makeDirectoryAsync,
  readDirectoryAsync,
} from 'expo-file-system/legacy';
import { fetchPhotosForTripIds } from '@/src/services/photoService';

const PINNED_KEY = 'offlinePinnedTripIds';
const MANIFEST_KEY = 'tripPhotoOfflineManifestV1';
const CACHE_SUBDIR = 'trip-photo-cache';

/** Max trips the user can save for offline (trip summary → Save offline). */
export const MAX_PINNED_TRIPS = 20;

type Manifest = Record<string, string>;

let manifestMemory: Manifest | null = null;

function cacheDirUri(): string | null {
  const base = documentDirectory;
  if (!base) return null;
  return `${base}${CACHE_SUBDIR}/`;
}

function fileNameForUrl(url: string): string {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `p_${(h >>> 0).toString(16)}_${url.length}.bin`;
}

async function readManifest(): Promise<Manifest> {
  if (manifestMemory) return manifestMemory;
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_KEY);
    manifestMemory = raw ? (JSON.parse(raw) as Manifest) : {};
  } catch {
    manifestMemory = {};
  }
  return manifestMemory!;
}

async function writeManifest(m: Manifest): Promise<void> {
  manifestMemory = m;
  await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(m));
}

/** Call after manifest-changing ops if other modules need fresh reads without reload. */
export function invalidateTripPhotoManifestCache(): void {
  manifestMemory = null;
}

export async function getPinnedTripIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]).filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function setPinnedTripIdsInternal(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)].slice(0, MAX_PINNED_TRIPS);
  await AsyncStorage.setItem(PINNED_KEY, JSON.stringify(unique));
}

export async function togglePinTrip(tripId: string): Promise<boolean> {
  const pinned = await getPinnedTripIds();
  const isOn = pinned.includes(tripId);
  if (isOn) {
    await setPinnedTripIdsInternal(pinned.filter((id) => id !== tripId));
    return false;
  }
  if (pinned.length >= MAX_PINNED_TRIPS) {
    throw new Error(`You can pin up to ${MAX_PINNED_TRIPS} trips for offline.`);
  }
  await setPinnedTripIdsInternal([...pinned, tripId]);
  return true;
}

export async function isTripPinned(tripId: string): Promise<boolean> {
  const pinned = await getPinnedTripIds();
  return pinned.includes(tripId);
}

/**
 * Download / evict files so on-disk cache matches trips the user saved for offline only.
 */
export async function reconcileTripPhotoCache(userId: string): Promise<void> {
  const dir = cacheDirUri();
  if (!dir) {
    console.warn('[tripPhotoOfflineCache] documentDirectory unavailable');
    return;
  }

  await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});

  const targetTripIds = await getPinnedTripIds();

  if (targetTripIds.length === 0) {
    await evictUrlsNotIn(new Set());
    return;
  }

  const photos = await fetchPhotosForTripIds(userId, targetTripIds);
  const targetUrls = new Set(photos.map((p) => p.url).filter(Boolean));

  const manifest = await readManifest();

  for (const url of targetUrls) {
    if (!manifest[url]) {
      manifest[url] = fileNameForUrl(url);
    }
  }
  await writeManifest(manifest);

  for (const url of targetUrls) {
    const fname = manifest[url];
    const fileUri = `${dir}${fname}`;
    const info = await getInfoAsync(fileUri);
    if (!info.exists) {
      try {
        await downloadAsync(url, fileUri);
      } catch (e) {
        console.warn('[tripPhotoOfflineCache] download failed', { url: url.slice(0, 80), e });
      }
    }
  }

  await evictUrlsNotIn(targetUrls);
}

async function evictUrlsNotIn(keepUrls: Set<string>): Promise<void> {
  const dir = cacheDirUri();
  if (!dir) return;

  const manifest = await readManifest();
  const next: Manifest = {};

  for (const [url, fname] of Object.entries(manifest)) {
    if (keepUrls.has(url)) {
      next[url] = fname;
      continue;
    }
    const fileUri = `${dir}${fname}`;
    await deleteAsync(fileUri, { idempotent: true }).catch(() => {});
  }

  await writeManifest(next);
}

/**
 * Remove all cached trip photos, pins, and manifest (e.g. sign out).
 */
export async function clearTripPhotoOfflineCache(): Promise<void> {
  const dir = cacheDirUri();
  if (dir) {
    try {
      const names = await readDirectoryAsync(dir);
      for (const name of names) {
        await deleteAsync(`${dir}${name}`, { idempotent: true }).catch(() => {});
      }
    } catch {
      // directory may not exist
    }
  }
  await AsyncStorage.removeItem(MANIFEST_KEY);
  await AsyncStorage.removeItem(PINNED_KEY);
  invalidateTripPhotoManifestCache();
}

/**
 * Prefer `file://` local copy when this URL was managed by the offline cache; otherwise the remote URL.
 */
export async function resolveTripPhotoUri(remoteUrl: string): Promise<string> {
  if (!remoteUrl || !remoteUrl.startsWith('http')) return remoteUrl;

  const manifest = await readManifest();
  const fname = manifest[remoteUrl];
  if (!fname) return remoteUrl;

  const dir = cacheDirUri();
  if (!dir) return remoteUrl;

  const fileUri = `${dir}${fname}`;
  const info = await getInfoAsync(fileUri);
  if (info.exists) return fileUri;
  return remoteUrl;
}
