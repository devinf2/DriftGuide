import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SpotFishingSummary } from '@/src/services/ai';

const STORAGE_KEY = 'driftguide_guide_intel_v1';

export type CachedGuideIntel = SpotFishingSummary & { locationId: string };

async function readAll(): Promise<Record<string, CachedGuideIntel>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const j = JSON.parse(raw) as Record<string, CachedGuideIntel>;
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

async function writeAll(map: Record<string, CachedGuideIntel>): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export async function saveGuideIntelForLocation(
  locationId: string,
  summary: SpotFishingSummary,
): Promise<void> {
  if (!locationId) return;
  const all = await readAll();
  all[locationId] = {
    ...summary,
    locationId,
    fetchedAt: summary.fetchedAt ?? new Date().toISOString(),
  };
  const keys = Object.keys(all);
  if (keys.length > 40) {
    for (const k of keys.slice(0, keys.length - 40)) {
      delete all[k];
    }
  }
  await writeAll(all);
}

export async function loadGuideIntelForLocation(locationId: string): Promise<CachedGuideIntel | null> {
  if (!locationId) return null;
  const all = await readAll();
  return all[locationId] ?? null;
}
