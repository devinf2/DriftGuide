import type { ImageSourcePropType } from 'react-native';

export type SpeciesImageOption = {
  name: string;
  image: ImageSourcePropType;
};

/** Featured species shown as horizontal image cards on the catch form (order matters). */
export const SPECIES_IMAGE_OPTIONS: SpeciesImageOption[] = [
  { name: 'Rainbow Trout', image: require('@/assets/images/species/rainbow-trout.png') },
  { name: 'Brown Trout', image: require('@/assets/images/species/brown-trout.png') },
  { name: 'Cutthroat Trout', image: require('@/assets/images/species/cutthroat-trout.png') },
  { name: 'Lake Trout', image: require('@/assets/images/species/lake-trout.png') },
  { name: 'Brook Trout', image: require('@/assets/images/species/brook-trout.png') },
  { name: 'Smallmouth Bass', image: require('@/assets/images/species/smallmouth-bass.png') },
  { name: 'Bluegill', image: require('@/assets/images/species/bluegill.png') },
  { name: 'Northern Pike', image: require('@/assets/images/species/northern-pike.png') },
];

export const SPECIES_PRESET_NAMES = SPECIES_IMAGE_OPTIONS.map((s) => s.name);

export function speciesCardShortLabel(name: string): string {
  return name.replace('Northern Pike', 'Pike').replace(' Trout', '').replace(' Bass', '');
}

/** Put recently logged species first; unknown names are skipped. */
export function orderSpeciesByRecent(
  recentNames: readonly string[],
  options: readonly SpeciesImageOption[] = SPECIES_IMAGE_OPTIONS,
): SpeciesImageOption[] {
  const byName = new Map(options.map((s) => [s.name, s]));
  const ordered: SpeciesImageOption[] = [];
  const seen = new Set<string>();

  for (const name of recentNames) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    const opt = byName.get(trimmed);
    if (opt) {
      ordered.push(opt);
      seen.add(trimmed);
    }
  }

  for (const opt of options) {
    if (!seen.has(opt.name)) ordered.push(opt);
  }

  return ordered;
}
