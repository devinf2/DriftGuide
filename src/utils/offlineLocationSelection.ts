import type { Location } from '@/src/types';
import type { BoundingBox } from '@/src/types/boundingBox';
import { isPointInBoundingBox } from '@/src/types/boundingBox';

/** Root location ids that have at least one catalog point (any descendant) inside `bbox`. */
export function rootLocationIdsWithPointsInBbox(
  allLocations: Location[],
  bbox: BoundingBox,
): Set<string> {
  const byId = new Map(allLocations.map((l) => [l.id, l]));
  const roots = new Set<string>();
  for (const loc of allLocations) {
    if (loc.latitude == null || loc.longitude == null) continue;
    if (!isPointInBoundingBox(loc.latitude, loc.longitude, bbox)) continue;
    let cur: string | undefined = loc.id;
    for (let i = 0; i < 64; i++) {
      if (!cur) break;
      const node = byId.get(cur);
      if (!node) break;
      if (!node.parent_location_id) {
        roots.add(node.id);
        break;
      }
      cur = node.parent_location_id;
    }
  }
  return roots;
}

/** Flat list: each root plus its children from `allLocations`. */
export function locationsForRoots(
  allLocations: Location[],
  rootIds: Set<string>,
): Location[] {
  const byParent = new Map<string, Location[]>();
  for (const loc of allLocations) {
    const pid = loc.parent_location_id;
    if (!pid) continue;
    const list = byParent.get(pid) ?? [];
    list.push(loc);
    byParent.set(pid, list);
  }
  const out: Location[] = [];
  const seen = new Set<string>();
  function visit(rootId: string) {
    const root = allLocations.find((l) => l.id === rootId);
    if (!root || seen.has(root.id)) return;
    seen.add(root.id);
    out.push(root);
    const kids = byParent.get(root.id) ?? [];
    for (const c of kids) visit(c.id);
  }
  for (const id of rootIds) visit(id);
  return out;
}
