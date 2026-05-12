import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Dev-only “simulate offline”: same Wi‑Fi as Metro still works; toggles app-wide unreachable
 * behavior (see `effectiveIsAppOnline` and `supabaseAuthStorage`).
 *
 * **Development:** `simulateOffline` is persisted so cold starts (force quit → reopen) still
 * test offline auth / session stretch with Expo Go.
 *
 * **Production:** `__DEV__` is false — merge forces `simulateOffline` off and the flag is never
 * shown in UI.
 */
type SimulateOfflineState = {
  simulateOffline: boolean;
  setSimulateOffline: (v: boolean) => void;
  toggleSimulateOffline: () => void;
};

export const useSimulateOfflineStore = create<SimulateOfflineState>()(
  persist(
    (set) => ({
      simulateOffline: false,
      setSimulateOffline: (simulateOffline) => set({ simulateOffline }),
      toggleSimulateOffline: () => set((s) => ({ simulateOffline: !s.simulateOffline })),
    }),
    {
      name: 'driftguide-simulate-offline-dev',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ simulateOffline: state.simulateOffline }),
      merge: (persisted, current) => {
        if (!__DEV__) {
          return { ...current, simulateOffline: false };
        }
        const p = persisted as Partial<Pick<SimulateOfflineState, 'simulateOffline'>> | undefined;
        return {
          ...current,
          simulateOffline:
            typeof p?.simulateOffline === 'boolean' ? p.simulateOffline : current.simulateOffline,
        };
      },
    },
  ),
);
