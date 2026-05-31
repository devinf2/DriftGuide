import { COMMON_FLIES } from '@/src/constants/fishingTypes';
import type { FlyCatalog } from '@/src/types';

export const BUNDLED_CATALOG_ID_PREFIX = 'bundle:';

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isBundledCatalogFlyId(flyId: string | null | undefined): boolean {
  return Boolean(flyId?.startsWith(BUNDLED_CATALOG_ID_PREFIX));
}

export function bundledCatalogIdForName(name: string): string {
  return `${BUNDLED_CATALOG_ID_PREFIX}${slugify(name)}`;
}

export function getBundledFlyNameById(bundledId: string): string | null {
  if (!isBundledCatalogFlyId(bundledId)) return null;
  const slug = bundledId.slice(BUNDLED_CATALOG_ID_PREFIX.length);
  const match = COMMON_FLIES.find((f) => slugify(f.name) === slug);
  return match?.name ?? null;
}

/** Offline-first catalog entries shipped in the app bundle. */
export function getBundledFlyCatalog(): FlyCatalog[] {
  const createdAt = '1970-01-01T00:00:00.000Z';
  return COMMON_FLIES.map((f) => ({
    id: bundledCatalogIdForName(f.name),
    name: f.name,
    type: 'fly' as const,
    photo_url: null,
    presentation: f.presentation,
    created_at: createdAt,
  }));
}
