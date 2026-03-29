import type { Location } from '@/src/types';

/**
 * Location detail map: the viewed spot, every ancestor (`parent_location_id` chain),
 * and every descendant (recursive children where this spot or its descendants are parent).
 */
export function spotMapRelatedLocationIds(root: Location, all: Location[]): Set<string> {
  const byId = new Map(all.map((l) => [l.id, l]));
  const ids = new Set<string>();
  ids.add(root.id);

  let cur: Location | undefined = root;
  while (cur?.parent_location_id) {
    const pid = cur.parent_location_id;
    ids.add(pid);
    cur = byId.get(pid);
  }

  const queue = [root.id];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const l of all) {
      if (l.parent_location_id === parentId && !ids.has(l.id)) {
        ids.add(l.id);
        queue.push(l.id);
      }
    }
  }

  return ids;
}

export function locationsForSpotMapContext(root: Location, all: Location[]): Location[] {
  const keep = spotMapRelatedLocationIds(root, all);
  return all.filter((l) => keep.has(l.id));
}
