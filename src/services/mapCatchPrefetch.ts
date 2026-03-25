import { fetchCatchesInBounds } from '@/src/services/sync';
import { mergeCachedCatchesFromRows } from '@/src/services/mapCatchLocalStore';
import type { BoundingBox } from '@/src/types/boundingBox';

/**
 * Fetch user catches in bbox and merge into AsyncStorage cache (for offline map pins).
 */
export async function prefetchCatchesForBounds(
  userId: string,
  bbox: BoundingBox,
): Promise<void> {
  const rows = await fetchCatchesInBounds(userId, bbox);
  await mergeCachedCatchesFromRows(rows);
}
