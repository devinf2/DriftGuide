import type { HatchCategory } from '@/src/data/driftGuideHatchChart';
import type { ThemeColors } from '@/src/constants/theme';

/** Distinct tints for category chips / matrix row accent (not in ThemeColors) */
export function hatchCategoryColor(category: HatchCategory, colors: ThemeColors): string {
  switch (category) {
    case 'midge':
      return colors.info;
    case 'mayfly':
      return colors.secondary;
    case 'caddis':
      return colors.warning;
    case 'stone':
      return colors.fish;
    case 'terrestrial':
      return colors.success;
    case 'stillwater':
      return colors.sky;
  }
}

export function activityCellColor(level: number, colors: ThemeColors): string {
  if (level <= 0) return colors.border;
  if (level === 1) return colors.primaryLight + '55';
  if (level === 2) return colors.secondary + 'AA';
  return colors.secondary;
}
