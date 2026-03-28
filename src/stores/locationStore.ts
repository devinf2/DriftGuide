import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Location } from '@/src/types';
import { supabase } from '@/src/services/supabase';
import { filterLocationsByQuery } from '@/src/utils/locationSearch';
import { activeLocationsOnly, isLocationActive } from '@/src/utils/locationVisibility';

interface LocationState {
  locations: Location[];
  recentLocationIds: string[];
  isLoading: boolean;
  lastAddedLocationId: string | null;
  /** When user taps Select on spot overview from plan-trip flow, we set this and go back so trip/new can apply it. */
  pendingPlanTripLocationId: string | null;
  fetchLocations: () => Promise<void>;
  searchLocations: (query: string) => Location[];
  getLocationById: (id: string) => Location | undefined;
  getChildLocations: (parentId: string) => Location[];
  addRecentLocation: (locationId: string) => void;
  getRecentLocations: () => Location[];
  setLastAddedLocationId: (id: string | null) => void;
  setPendingPlanTripLocationId: (id: string | null) => void;
}

export const useLocationStore = create<LocationState>()(
  persist(
    (set, get) => ({
      locations: [],
      recentLocationIds: [],
      isLoading: false,
      lastAddedLocationId: null,
      pendingPlanTripLocationId: null,

      fetchLocations: async () => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase
            .from('locations')
            .select('*')
            .is('deleted_at', null)
            .order('name');

          if (!error && data) {
            set({ locations: activeLocationsOnly(data as Location[]) });
          }
        } catch (error) {
          console.error('Error fetching locations:', error);
        } finally {
          set({ isLoading: false });
        }
      },

      searchLocations: (query) => {
        const { locations } = get();
        return filterLocationsByQuery(activeLocationsOnly(locations), query);
      },

      getLocationById: (id) => {
        const loc = get().locations.find(l => l.id === id);
        return loc && isLocationActive(loc) ? loc : undefined;
      },

      getChildLocations: (parentId) => {
        return activeLocationsOnly(get().locations).filter(
          loc => loc.parent_location_id === parentId,
        );
      },

      addRecentLocation: (locationId) => {
        set(state => {
          const filtered = state.recentLocationIds.filter(id => id !== locationId);
          return { recentLocationIds: [locationId, ...filtered].slice(0, 10) };
        });
      },

      getRecentLocations: () => {
        const { locations, recentLocationIds } = get();
        const active = activeLocationsOnly(locations);
        return recentLocationIds
          .map(id => active.find(loc => loc.id === id))
          .filter((loc): loc is Location => loc !== undefined);
      },

      setLastAddedLocationId: (id) => {
        set({ lastAddedLocationId: id });
      },

      setPendingPlanTripLocationId: (id) => {
        set({ pendingPlanTripLocationId: id });
      },
    }),
    {
      name: 'location-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Do not persist `locations`: disk cache can lack `deleted_at` after soft-delete on server, so pins stay wrong.
      partialize: (state) => ({
        recentLocationIds: state.recentLocationIds,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<Pick<LocationState, 'recentLocationIds'>> | undefined;
        return {
          ...current,
          recentLocationIds: p?.recentLocationIds ?? current.recentLocationIds,
          locations: [],
        };
      },
    }
  )
);
