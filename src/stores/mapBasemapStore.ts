import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isMapboxBasemapId, type MapboxBasemapId } from '@/src/constants/mapbox';

interface MapBasemapState {
  basemapId: MapboxBasemapId;
  setBasemapId: (id: MapboxBasemapId) => void;
}

export const useMapBasemapStore = create<MapBasemapState>()(
  persist(
    (set) => ({
      basemapId: 'outdoors',
      setBasemapId: (basemapId) => set({ basemapId }),
    }),
    {
      name: 'map-basemap-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ basemapId: state.basemapId }),
      merge: (persisted, current) => {
        const p = persisted as Partial<MapBasemapState> | undefined;
        const id = p?.basemapId;
        return {
          ...current,
          ...p,
          basemapId: isMapboxBasemapId(id) ? id : current.basemapId,
        };
      },
    },
  ),
);
