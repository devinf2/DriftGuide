import type { LocationType } from '@/src/types';

// DriftGuide brand palette: navy (#2C4670), medium blue (#3B7DAE), teal (#3CB2BB)
export const Colors = {
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
};

/** Colors for location types (river vs lake etc.) — water-body representative. */
export const LocationTypeColors: Record<LocationType, string> = {
  stream: '#60A5FA',   // light blue — small flowing water
  river: '#3B7DAE',    // medium blue — primaryLight, flowing
  lake: '#1E3A5F',     // deep blue — still water
  reservoir: '#0E7490', // teal — man-made impoundment
  pond: '#047857',      // emerald — small still water, often vegetated
};

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
