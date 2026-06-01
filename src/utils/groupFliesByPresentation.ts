import {
  COMMON_FLIES_BY_NAME,
  FLY_PRESENTATION_ORDER,
  FLY_PRESENTATION_SHORT_LABELS,
} from '@/src/constants/fishingTypes';
import type { Fly, FlyCatalog, FlyPresentation } from '@/src/types';

export type FlyPresentationSectionKey = FlyPresentation | 'other';

export type FlyPresentationSection<T> = {
  key: FlyPresentationSectionKey;
  label: string;
  items: T[];
};

export function resolveCatalogFlyPresentation(fly: FlyCatalog): FlyPresentation | null {
  return fly.presentation ?? null;
}

export function resolveUserFlyPresentation(fly: Fly, catalog: FlyCatalog[]): FlyPresentation | null {
  if (fly.presentation) return fly.presentation;
  if (fly.fly_id) {
    const catalogFly = catalog.find((c) => c.id === fly.fly_id);
    if (catalogFly?.presentation) return catalogFly.presentation;
  }
  return COMMON_FLIES_BY_NAME[fly.name]?.presentation ?? null;
}

export function groupItemsByPresentation<T>(
  items: T[],
  getPresentation: (item: T) => FlyPresentation | null,
  compareItems?: (a: T, b: T) => number,
): FlyPresentationSection<T>[] {
  const buckets = new Map<FlyPresentationSectionKey, T[]>();
  for (const item of items) {
    const presentation = getPresentation(item);
    const key: FlyPresentationSectionKey = presentation ?? 'other';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const sections: FlyPresentationSection<T>[] = [];
  for (const presentation of FLY_PRESENTATION_ORDER) {
    const bucket = buckets.get(presentation);
    if (!bucket?.length) continue;
    if (compareItems) bucket.sort(compareItems);
    sections.push({
      key: presentation,
      label: FLY_PRESENTATION_SHORT_LABELS[presentation],
      items: bucket,
    });
  }

  const other = buckets.get('other');
  if (other?.length) {
    if (compareItems) other.sort(compareItems);
    sections.push({ key: 'other', label: 'Other', items: other });
  }

  return sections;
}
