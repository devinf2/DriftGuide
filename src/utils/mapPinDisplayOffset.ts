/**
 * Buckets used with catalog pin stacking / overlap detection (~1 m).
 * Exported so marker sort and display offset stay aligned.
 */
export const COORD_STACK_EPS = 1e-5;

export function stackKey(lat: number, lng: number): string {
  const r = (x: number) => Math.round(x / COORD_STACK_EPS) * COORD_STACK_EPS;
  return `${r(lat)},${r(lng)}`;
}

type Item = { id: string; lat: number; lng: number };

/**
 * When several pins share the same map point, nudge each slightly in a ring so every location
 * stays visible and tappable. Coordinates are display-only; callers still use real ids for navigation.
 */
export function displayLngLatForOverlappingItems<T extends Item>(items: T[]): Map<string, [number, number]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = stackKey(item.lat, item.lng);
    const g = groups.get(k) ?? [];
    g.push(item);
    groups.set(k, g);
  }
  const out = new Map<string, [number, number]>();
  for (const group of groups.values()) {
    const n = group.length;
    for (let i = 0; i < n; i++) {
      const item = group[i]!;
      out.set(item.id, offsetLngLatRing(item.lat, item.lng, i, n));
    }
  }
  return out;
}

/** ~6 m radius ring at equator; scales with latitude for lng. */
function offsetLngLatRing(lat: number, lng: number, index: number, clusterSize: number): [number, number] {
  if (clusterSize <= 1) return [lng, lat];
  const stepDeg = 0.000055;
  const angle = (2 * Math.PI * index) / clusterSize;
  const latRad = (lat * Math.PI) / 180;
  const dLat = stepDeg * Math.sin(angle);
  const dLng = (stepDeg * Math.cos(angle)) / Math.max(0.2, Math.cos(latRad));
  return [lng + dLng, lat + dLat];
}
