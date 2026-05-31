import type { Fly, FlyCatalog, FlyChangeData } from '@/src/types';

function normalizeFlyColor(color: string | null | undefined): string | null {
  const trimmed = color?.trim();
  return trimmed ? trimmed : null;
}

/** Best-effort match of a rig slot to a user fly box row. */
export function findUserBoxFlyForSelection(
  userFlies: Fly[],
  pattern: string,
  size: number | null | undefined,
  color: string | null | undefined,
): Fly | undefined {
  const pat = pattern.trim();
  if (!pat) return undefined;
  const normalizedSize = size ?? null;
  const normalizedColor = normalizeFlyColor(color);

  const exact = userFlies.find(
    (f) =>
      f.name === pat &&
      (f.size ?? null) === normalizedSize &&
      normalizeFlyColor(f.color) === normalizedColor,
  );
  if (exact) return exact;

  const byNameSize = userFlies.find((f) => f.name === pat && (f.size ?? null) === normalizedSize);
  if (byNameSize) return byNameSize;

  const byName = userFlies.filter((f) => f.name === pat);
  if (byName.length === 1) return byName[0];
  return undefined;
}

export function resolveUserBoxFlyIdForPicker(
  userBoxFlyId: string | null,
  catalogFlyId: string | null,
  pattern: string | null | undefined,
  size: number | null | undefined,
  color: string | null | undefined,
  userFlies: Fly[],
  catalog: FlyCatalog[],
): string | null {
  if (userBoxFlyId && userFlies.some((f) => f.id === userBoxFlyId)) {
    return userBoxFlyId;
  }
  if (catalogFlyId) {
    const fromBox = userFlies.find((f) => f.fly_id === catalogFlyId);
    if (fromBox) return fromBox.id;
  }
  if (pattern?.trim()) {
    const match = findUserBoxFlyForSelection(userFlies, pattern, size, color);
    if (match) return match.id;
  }
  return null;
}

export function seedSelectionFromFlyChange(
  p: FlyChangeData | null | undefined,
  userFlies: Fly[],
  catalog: FlyCatalog[],
): { userBoxId: string | null; catalogFlyId: string | null; manual: boolean } {
  if (!p?.pattern?.trim() && !p?.user_fly_box_id) {
    return { userBoxId: null, catalogFlyId: null, manual: false };
  }
  if (p.user_fly_box_id && userFlies.some((f) => f.id === p.user_fly_box_id)) {
    return { userBoxId: p.user_fly_box_id, catalogFlyId: null, manual: false };
  }
  const pat = p.pattern?.trim() ?? '';
  const fromBox = pat ? findUserBoxFlyForSelection(userFlies, pat, p.size, p.color) : undefined;
  if (fromBox) return { userBoxId: fromBox.id, catalogFlyId: null, manual: false };
  if (p.fly_id && catalog.some((c) => c.id === p.fly_id)) {
    const catalogInBox = userFlies.find((f) => f.fly_id === p.fly_id);
    if (catalogInBox) return { userBoxId: catalogInBox.id, catalogFlyId: null, manual: false };
    return { userBoxId: null, catalogFlyId: p.fly_id, manual: false };
  }
  const byName = catalog.find((c) => c.name === pat);
  if (byName) {
    const catalogInBox = userFlies.find((f) => f.fly_id === byName.id);
    if (catalogInBox) return { userBoxId: catalogInBox.id, catalogFlyId: null, manual: false };
    return { userBoxId: null, catalogFlyId: byName.id, manual: false };
  }
  if (p.user_fly_box_id) {
    return { userBoxId: p.user_fly_box_id, catalogFlyId: null, manual: false };
  }
  return { userBoxId: null, catalogFlyId: null, manual: Boolean(pat) };
}

export function isSameFlyChangeSelection(
  a: FlyChangeData | null | undefined,
  b: FlyChangeData | null | undefined,
): boolean {
  if (!a?.pattern?.trim() || !b?.pattern?.trim()) return false;

  const patA = a.pattern.trim();
  const patB = b.pattern.trim();
  if (patA !== patB) return false;

  if (a.user_fly_box_id && b.user_fly_box_id && a.user_fly_box_id === b.user_fly_box_id) {
    return true;
  }

  if (a.fly_id && b.fly_id && a.fly_id === b.fly_id) {
    return true;
  }

  const sizeA = a.size ?? null;
  const sizeB = b.size ?? null;
  if (sizeA != null && sizeB != null && sizeA !== sizeB) return false;

  const colorA = normalizeFlyColor(a.color);
  const colorB = normalizeFlyColor(b.color);
  if (colorA != null && colorB != null && colorA !== colorB) return false;

  return true;
}
