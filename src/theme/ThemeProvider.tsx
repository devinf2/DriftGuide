import { colorsForScheme, type ThemeColors } from '@/src/constants/theme';
import { useThemeStore } from '@/src/stores/themeStore';
import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { Appearance } from 'react-native';

export type ResolvedScheme = 'light' | 'dark';

type AppThemeContextValue = {
  colors: ThemeColors;
  resolvedScheme: ResolvedScheme;
  darkModeEnabled: boolean;
  setDarkModeEnabled: (value: boolean) => void;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

/** Toggle on → dark palette; toggle off → light palette (not tied to device appearance). */
function resolveScheme(darkModeEnabled: boolean): ResolvedScheme {
  return darkModeEnabled ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const darkModeEnabled = useThemeStore((s) => s.darkModeEnabled);
  const setDarkModeEnabled = useThemeStore((s) => s.setDarkModeEnabled);

  const resolvedScheme = useMemo(() => resolveScheme(darkModeEnabled), [darkModeEnabled]);

  const colors = useMemo(() => colorsForScheme(resolvedScheme), [resolvedScheme]);

  useEffect(() => {
    Appearance.setColorScheme(resolvedScheme === 'dark' ? 'dark' : 'light');
  }, [resolvedScheme]);

  const value = useMemo<AppThemeContextValue>(
    () => ({
      colors,
      resolvedScheme,
      darkModeEnabled,
      setDarkModeEnabled,
    }),
    [colors, resolvedScheme, darkModeEnabled, setDarkModeEnabled],
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used within ThemeProvider');
  }
  return ctx;
}
