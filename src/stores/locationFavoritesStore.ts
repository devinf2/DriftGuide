import { create } from 'zustand';
import {
  addFavoriteLocation,
  fetchFavoriteLocationIds,
  removeFavoriteLocation,
} from '@/src/services/locationFavorites';

type LocationFavoritesState = {
  ids: string[];
  loading: boolean;
  reset: () => void;
  refresh: (userId: string | null) => Promise<void>;
  /** Optimistic toggle; no-op if userId is null. */
  toggle: (userId: string | null, locationId: string) => Promise<void>;
  favoriteIdSet: () => ReadonlySet<string>;
};

export const useLocationFavoritesStore = create<LocationFavoritesState>((set, get) => ({
  ids: [],
  loading: false,

  reset: () => set({ ids: [], loading: false }),

  favoriteIdSet: () => new Set(get().ids),

  refresh: async (userId: string | null) => {
    if (!userId) {
      set({ ids: [], loading: false });
      return;
    }
    set({ loading: true });
    try {
      const ids = await fetchFavoriteLocationIds(userId);
      set({ ids, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  toggle: async (userId: string | null, locationId: string) => {
    if (!userId) return;

    const was = get().ids.includes(locationId);
    if (was) {
      set((s) => ({ ids: s.ids.filter((id) => id !== locationId) }));
      const { error } = await removeFavoriteLocation(userId, locationId);
      if (error) {
        set((s) => ({ ids: s.ids.includes(locationId) ? s.ids : [...s.ids, locationId] }));
      }
    } else {
      set((s) => ({ ids: [...s.ids, locationId] }));
      const { error } = await addFavoriteLocation(userId, locationId);
      if (error) {
        set((s) => ({ ids: s.ids.filter((id) => id !== locationId) }));
      }
    }
  },
}));
