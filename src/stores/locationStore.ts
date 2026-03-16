import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Location } from '@/src/types';
import { supabase } from '@/src/services/supabase';

interface LocationState {
  locations: Location[];
  recentLocationIds: string[];
  isLoading: boolean;
  lastAddedLocationId: string | null;
  fetchLocations: () => Promise<void>;
  searchLocations: (query: string) => Location[];
  getLocationById: (id: string) => Location | undefined;
  getChildLocations: (parentId: string) => Location[];
  addRecentLocation: (locationId: string) => void;
  getRecentLocations: () => Location[];
  setLastAddedLocationId: (id: string | null) => void;
}

export const useLocationStore = create<LocationState>()(
  persist(
    (set, get) => ({
      locations: [],
      recentLocationIds: [],
      isLoading: false,
      lastAddedLocationId: null,

      fetchLocations: async () => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase
            .from('locations')
            .select('*')
            .order('name');

          if (!error && data) {
            set({ locations: data as Location[] });
          }
        } catch (error) {
          console.error('Error fetching locations:', error);
        } finally {
          set({ isLoading: false });
        }
      },

      searchLocations: (query) => {
        const { locations } = get();
        const lower = query.toLowerCase();
        return locations.filter(loc =>
          loc.name.toLowerCase().includes(lower)
        );
      },

      getLocationById: (id) => {
        return get().locations.find(loc => loc.id === id);
      },

      getChildLocations: (parentId) => {
        return get().locations.filter(loc => loc.parent_location_id === parentId);
      },

      addRecentLocation: (locationId) => {
        set(state => {
          const filtered = state.recentLocationIds.filter(id => id !== locationId);
          return { recentLocationIds: [locationId, ...filtered].slice(0, 10) };
        });
      },

      getRecentLocations: () => {
        const { locations, recentLocationIds } = get();
        return recentLocationIds
          .map(id => locations.find(loc => loc.id === id))
          .filter((loc): loc is Location => loc !== undefined);
      },

      setLastAddedLocationId: (id) => {
        set({ lastAddedLocationId: id });
      },
    }),
    {
      name: 'location-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        locations: state.locations,
        recentLocationIds: state.recentLocationIds,
      }),
    }
  )
);
