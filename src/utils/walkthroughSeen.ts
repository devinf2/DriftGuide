import AsyncStorage from '@react-native-async-storage/async-storage';

/** Local-only flag so the intro walkthrough shows once and never reappears. */
const KEY = 'driftguide_walkthrough_seen_v1';

export async function hasSeenWalkthrough(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    // If storage is unavailable, don't trap the user behind the walkthrough.
    return true;
  }
}

export async function markWalkthroughSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
}
