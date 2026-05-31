import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const MAX_RECENT_SPECIES = 16;

interface RecentSpeciesState {
  /** Most recently logged species first. */
  recentSpeciesNames: string[];
  addRecentSpecies: (name: string) => void;
}

export const useRecentSpeciesStore = create<RecentSpeciesState>()(
  persist(
    (set) => ({
      recentSpeciesNames: [],
      addRecentSpecies: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((state) => {
          const filtered = state.recentSpeciesNames.filter((n) => n !== trimmed);
          return { recentSpeciesNames: [trimmed, ...filtered].slice(0, MAX_RECENT_SPECIES) };
        });
      },
    }),
    {
      name: 'recent-species-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ recentSpeciesNames: state.recentSpeciesNames }),
    },
  ),
);
