import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Toggle state for map data overlays (independent of the basemap radio in {@link useMapBasemapStore}).
 * Persisted so a user's "Public / Private Land" choice survives app restarts.
 */
interface MapOverlayState {
  landOwnershipVisible: boolean;
  setLandOwnershipVisible: (visible: boolean) => void;
  toggleLandOwnership: () => void;
}

export const useMapOverlayStore = create<MapOverlayState>()(
  persist(
    (set) => ({
      landOwnershipVisible: false,
      setLandOwnershipVisible: (landOwnershipVisible) => set({ landOwnershipVisible }),
      toggleLandOwnership: () =>
        set((s) => ({ landOwnershipVisible: !s.landOwnershipVisible })),
    }),
    {
      name: 'driftguide-map-overlays',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ landOwnershipVisible: state.landOwnershipVisible }),
    },
  ),
);
