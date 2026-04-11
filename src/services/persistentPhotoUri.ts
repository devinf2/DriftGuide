import {
  deleteAsync,
  documentDirectory,
  makeDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import { v4 as uuidv4 } from 'uuid';

const SUBDIR = 'pending_photos/';

/** True if URI is already in our app sandbox pending folder (do not re-copy). */
export function isSandboxPendingPhotoUri(uri: string): boolean {
  const base = documentDirectory;
  if (!base) return uri.includes(SUBDIR);
  return uri.startsWith(base) && uri.includes(SUBDIR);
}

/**
 * Copy a camera/picker URI into the app document directory so it survives until upload.
 */
export async function copyUriToPendingPhotoSandbox(sourceUri: string): Promise<string> {
  if (isSandboxPendingPhotoUri(sourceUri)) return sourceUri;

  const base = documentDirectory;
  if (!base) throw new Error('Document directory unavailable');

  const dir = `${base}${SUBDIR}`;
  await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});

  const rawExt = sourceUri.split('.').pop()?.split('?')[0]?.toLowerCase();
  const ext = rawExt && rawExt.length <= 5 && /^[a-z0-9]+$/.test(rawExt) ? rawExt : 'jpg';
  const dest = `${dir}${uuidv4()}.${ext}`;

  const b64 = await readAsStringAsync(sourceUri, { encoding: 'base64' });
  await writeAsStringAsync(dest, b64, { encoding: 'base64' });
  return dest;
}

export async function deleteSandboxPendingPhotoFile(uri: string): Promise<void> {
  if (!isSandboxPendingPhotoUri(uri)) return;
  await deleteAsync(uri, { idempotent: true }).catch(() => {});
}
