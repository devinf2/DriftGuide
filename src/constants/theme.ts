import type { LocationType } from '@/src/types';

// DriftGuide brand palette: navy (#2C4670), medium blue (#3B7DAE), teal (#3CB2BB)

export const ColorsLight = {
  primary: '#2C4670',
  primaryLight: '#3B7DAE',
  primaryDark: '#1E3550',
  secondary: '#3CB2BB',
  secondaryLight: '#5EC5CE',
  accent: '#3CB2BB',
  background: '#F1F5F9',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  text: '#2C4670',
  textSecondary: '#4A6B8A',
  textTertiary: '#6B8AA3',
  textInverse: '#FFFFFF',
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B7DAE',
  fish: '#2C4670',
  water: '#3CB2BB',
  sky: '#93C5FD',
  shadow: 'rgba(44, 70, 112, 0.08)',
} as const;

export const ColorsDark = {
  primary: '#3B7DAE',
  primaryLight: '#5B9BD4',
  primaryDark: '#2C4670',
  secondary: '#3CB2BB',
  secondaryLight: '#5EC5CE',
  accent: '#3CB2BB',
  background: '#0F172A',
  surface: '#1E293B',
  surfaceElevated: '#334155',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  textInverse: '#FFFFFF',
  border: '#334155',
  borderLight: '#1E293B',
  success: '#4ADE80',
  warning: '#FBBF24',
  error: '#F87171',
  info: '#5B9BD4',
  fish: '#5B9BD4',
  water: '#3CB2BB',
  sky: '#60A5FA',
  shadow: 'rgba(0, 0, 0, 0.35)',
} as const;

export type ThemeColors = {
  primary: string;
  primaryLight: string;
  primaryDark: string;
  secondary: string;
  secondaryLight: string;
  accent: string;
  background: string;
  surface: string;
  surfaceElevated: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  border: string;
  borderLight: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  fish: string;
  water: string;
  sky: string;
  shadow: string;
};

/** @deprecated Use useAppTheme().colors */
export const Colors: ThemeColors = ColorsLight as ThemeColors;

/** Colors for location types on maps and lists. */
export const LocationTypeColors: Record<LocationType, string> = {
  stream: '#60A5FA',
  river: '#3B7DAE',
  lake: '#1E3A5F',
  reservoir: '#0E7490',
  pond: '#047857',
  access_point: '#92400E', // brown — trail / put-in context
  parking: '#64748B', // slate — infrastructure
};

/**
 * Brighter accents for catalog map pins when the app dark palette is active.
 * Dark pin disks (#1E293B) need high-luminance glyphs; several light-theme type colors (e.g. lake #1E3A5F) disappear on them.
 */
const LOCATION_TYPE_MAP_PIN_DARK: Record<LocationType, string> = {
  stream: '#7DD3FC',
  river: '#38BDF8',
  lake: '#60A5FA',
  reservoir: '#22D3EE',
  pond: '#4ADE80',
  access_point: '#FBBF24',
  parking: '#E2E8F0',
};

/** Icon / marker accent for a location type on the map (list rows still use {@link LocationTypeColors}). */
export function locationTypeMapPinAccent(
  type: LocationType,
  scheme: 'light' | 'dark',
  fallback?: string,
): string {
  const base = scheme === 'dark' ? LOCATION_TYPE_MAP_PIN_DARK[type] : LocationTypeColors[type];
  return base ?? fallback ?? LocationTypeColors[type];
}

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 28,
  xxxl: 34,
  hero: 48,
};

export const BorderRadius = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export function colorsForScheme(scheme: 'light' | 'dark'): ThemeColors {
  return (scheme === 'dark' ? ColorsDark : ColorsLight) as ThemeColors;
}
