import type { ImageSourcePropType } from 'react-native';

/** Bundled catalog fly photos keyed by normalized pattern name. */
const FLY_IMAGES_BY_NAME: Record<string, ImageSourcePropType> = {
  'royal wulff': require('@/assets/images/flies/royal-wulff.png'),
  'zebra midge': require('@/assets/images/flies/zebra-midge.png'),
};

function normalizeFlyName(name: string): string {
  return name.trim().toLowerCase();
}

export function getBundledFlyImageSource(name: string | null | undefined): ImageSourcePropType | null {
  if (!name?.trim()) return null;
  return FLY_IMAGES_BY_NAME[normalizeFlyName(name)] ?? null;
}

export const BUNDLED_FLY_IMAGE_NAMES = Object.keys(FLY_IMAGES_BY_NAME).map(
  (k) => k.replace(/\b\w/g, (c) => c.toUpperCase()),
);
