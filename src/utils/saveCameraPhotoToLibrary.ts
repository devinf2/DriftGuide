import * as MediaLibrary from 'expo-media-library';

/**
 * Saves a photo taken in-app to the device camera roll / photo library.
 * Uses write-only permission on iOS (add photos, not read the library).
 * Failures are non-fatal — the in-app copy is still used.
 */
export async function saveCameraPhotoToLibrary(uri: string): Promise<boolean> {
  if (!uri.trim()) return false;
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync(true);
    if (status !== 'granted') {
      console.warn('[saveCameraPhotoToLibrary] permission denied');
      return false;
    }
    await MediaLibrary.createAssetAsync(uri);
    return true;
  } catch (e) {
    console.warn('[saveCameraPhotoToLibrary] failed', e);
    return false;
  }
}
