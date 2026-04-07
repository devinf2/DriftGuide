import { create } from 'zustand';

/**
 * Toggle state for dev “simulate offline”. Honored only when `__DEV__` (see `effectiveIsAppOnline`).
 * Production builds never read this as “offline” — `__DEV__` is false in release.
 */
type SimulateOfflineState = {
  simulateOffline: boolean;
  setSimulateOffline: (v: boolean) => void;
  toggleSimulateOffline: () => void;
};

export const useSimulateOfflineStore = create<SimulateOfflineState>((set) => ({
  simulateOffline: false,
  setSimulateOffline: (v) => set({ simulateOffline: v }),
  toggleSimulateOffline: () => set((s) => ({ simulateOffline: !s.simulateOffline })),
}));
