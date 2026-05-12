import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import type { SupportedStorage } from '@supabase/auth-js';
import { stretchPersistedAuthSessionJsonForOfflineRead } from '@/src/services/supabaseAuthSessionStretch';
import { isAppReachableFromNetInfoState } from '@/src/utils/netReachability';
import { useSimulateOfflineStore } from '@/src/stores/simulateOfflineStore';

/**
 * When NetInfo says we are unreachable, `getItem` returns a **clone** of the persisted session
 * JSON with `expires_at` nudged into the future so `getSession` / `_recoverAndRefresh` restore
 * the saved user without a network round-trip. We never persist this adjusted value.
 *
 * The access JWT may still be expired for PostgREST until the next successful refresh online;
 * local/offline features use user id + on-device caches.
 */

function isSimulatedOfflineDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ && useSimulateOfflineStore.getState().simulateOffline;
}

/** Sim offline is persisted in dev; GoTrue may read storage before persist finishes — wait briefly. */
async function ensureSimulateOfflineStoreHydrated(): Promise<void> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const p = useSimulateOfflineStore.persist;
  if (p.hasHydrated()) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    let timeoutId: ReturnType<typeof setTimeout>;
    const unsub = p.onFinishHydration(() => {
      clearTimeout(timeoutId);
      unsub();
      finish();
    });

    timeoutId = setTimeout(() => {
      unsub();
      finish();
    }, 3000);

    queueMicrotask(() => {
      if (p.hasHydrated()) {
        clearTimeout(timeoutId);
        unsub();
        finish();
      }
    });
  });
}

async function deviceReachableForAuth(): Promise<boolean> {
  await ensureSimulateOfflineStoreHydrated();
  const state = await NetInfo.fetch();
  let reachable = isAppReachableFromNetInfoState(state);
  if (isSimulatedOfflineDev()) reachable = false;
  return reachable;
}

export function createDriftGuideSupabaseAuthStorage(): SupportedStorage {
  return {
    async getItem(key: string) {
      const raw = await AsyncStorage.getItem(key);
      if (raw == null) return raw;

      try {
        if (await deviceReachableForAuth()) {
          return raw;
        }

        const stretched = stretchPersistedAuthSessionJsonForOfflineRead(raw);
        return stretched ?? raw;
      } catch {
        return raw;
      }
    },
    setItem(key: string, value: string) {
      return AsyncStorage.setItem(key, value);
    },
    removeItem(key: string) {
      return AsyncStorage.removeItem(key);
    },
  };
}
