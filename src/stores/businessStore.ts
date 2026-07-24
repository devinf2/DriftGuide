import { create } from 'zustand';
import { Business } from '@/src/types';
import { fetchBusinesses, getBusinessById } from '@/src/services/businessService';

type BusinessState = {
  businesses: Business[];
  loading: boolean;
  lastFetchedAt: number | null;
  /** Whether the map should render business pins (spots vs. businesses filter). */
  showOnMap: boolean;
  reset: () => void;
  setShowOnMap: (show: boolean) => void;
  fetchAll: () => Promise<void>;
  /** Read from cache first; fall back to a direct fetch. */
  getById: (id: string) => Promise<Business | null>;
  upsert: (business: Business) => void;
};

export const useBusinessStore = create<BusinessState>((set, get) => ({
  businesses: [],
  loading: false,
  lastFetchedAt: null,
  showOnMap: true,

  reset: () => set({ businesses: [], loading: false, lastFetchedAt: null }),

  setShowOnMap: (show: boolean) => set({ showOnMap: show }),

  fetchAll: async () => {
    set({ loading: true });
    try {
      const businesses = await fetchBusinesses();
      set({ businesses, loading: false, lastFetchedAt: Date.now() });
    } catch (e) {
      console.warn('[businessStore.fetchAll] failed', e);
      set({ loading: false });
    }
  },

  getById: async (id: string) => {
    const cached = get().businesses.find((b) => b.id === id);
    if (cached) return cached;
    const fresh = await getBusinessById(id);
    if (fresh) get().upsert(fresh);
    return fresh;
  },

  upsert: (business: Business) =>
    set((s) => {
      const rest = s.businesses.filter((b) => b.id !== business.id);
      return { businesses: [...rest, business].sort((a, b) => a.name.localeCompare(b.name)) };
    }),
}));
