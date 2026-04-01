import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ThemeState {
  /** When true, use dark palette; when false, use light palette (app choice only, not system). */
  darkModeEnabled: boolean;
  setDarkModeEnabled: (value: boolean) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      darkModeEnabled: true,
      setDarkModeEnabled: (darkModeEnabled) => set({ darkModeEnabled }),
    }),
    {
      name: 'driftguide-theme',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ darkModeEnabled: state.darkModeEnabled }),
      merge: (persisted, current) => {
        const p = persisted as Partial<ThemeState> | undefined;
        return {
          ...current,
          ...p,
          darkModeEnabled: typeof p?.darkModeEnabled === 'boolean' ? p.darkModeEnabled : current.darkModeEnabled,
        };
      },
    },
  ),
);
