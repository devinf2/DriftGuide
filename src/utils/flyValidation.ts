/** Placeholder catalog name when user adds a fly with only a photo or partial fields. */
export const UNTITLED_FLY_NAME = 'Untitled fly';

export function isUntitledFlyName(name: string | null | undefined): boolean {
  const t = name?.trim();
  return !t || t === UNTITLED_FLY_NAME || t.startsWith('Fly · ');
}

export function displayFlyName(name: string | null | undefined): string {
  const t = name?.trim();
  if (!t || isUntitledFlyName(t)) return 'My fly';
  return t;
}

export function isFlyInputValid(input: {
  name?: string | null;
  photo?: string | null;
  size?: number | null;
  color?: string | null;
  catalogFlyId?: string | null;
}): boolean {
  return Boolean(
    input.catalogFlyId ||
      input.name?.trim() ||
      input.photo?.trim() ||
      input.size != null ||
      input.color?.trim(),
  );
}

export function resolveFlyNameForSave(
  name: string | null | undefined,
  hasPhoto: boolean,
  catalogName?: string | null,
): string {
  if (catalogName?.trim()) return catalogName.trim();
  if (name?.trim()) return name.trim();
  if (hasPhoto) return UNTITLED_FLY_NAME;
  return '';
}

export function isFlySelectionValid(input: {
  pattern?: string | null;
  size?: number | null;
  color?: string | null;
  userBoxFlyId?: string | null;
  catalogFlyId?: string | null;
  photoUrl?: string | null;
}): boolean {
  return Boolean(
    input.userBoxFlyId ||
      input.catalogFlyId ||
      input.pattern?.trim() ||
      input.photoUrl?.trim() ||
      input.size != null ||
      input.color?.trim(),
  );
}
