import type { CatchData } from '@/src/types';

function dedupePreserveOrder(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const t = u?.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Ordered image URLs for a catch (remote or local file URIs). */
export function normalizeCatchPhotoUrls(data: CatchData): string[] {
  const fromUrls = (data.photo_urls ?? []).map((u) => u?.trim()).filter(Boolean) as string[];
  if (fromUrls.length) return dedupePreserveOrder(fromUrls);
  const one = data.photo_url?.trim();
  return one ? [one] : [];
}

export function getCatchHeroPhotoUrl(data: CatchData): string | null {
  const urls = normalizeCatchPhotoUrls(data);
  return urls[0] ?? null;
}

export function catchDataWithAppendedPhotoUrl(data: CatchData, url: string): CatchData {
  const trimmed = url.trim();
  if (!trimmed) return data;
  const urls = dedupePreserveOrder([...normalizeCatchPhotoUrls(data), trimmed]);
  return {
    ...data,
    photo_urls: urls,
    photo_url: urls[0] ?? null,
  };
}

export function catchDataWithRemovedPhotoAtIndex(data: CatchData, index: number): CatchData {
  const urls = normalizeCatchPhotoUrls(data);
  if (index < 0 || index >= urls.length) return data;
  const next = urls.filter((_, i) => i !== index);
  return {
    ...data,
    photo_urls: next.length ? next : null,
    photo_url: next[0] ?? null,
  };
}
