import { describe, expect, it } from 'vitest';
import type { Fly, FlyCatalog } from '@/src/types';
import {
  findUserBoxFlyForSelection,
  isSameFlyChangeSelection,
  seedSelectionFromFlyChange,
} from './flyPickerSelection';

const userFlies: Fly[] = [
  {
    id: 'box-royal',
    name: 'Royal Wulff',
    type: 'dry',
    size: 18,
    color: null,
    photo_url: 'https://example.com/royal.png',
    fly_id: 'cat-royal',
  },
  {
    id: 'box-zebra',
    name: 'Zebra Midge',
    type: 'nymph',
    size: 12,
    color: '',
    photo_url: 'https://example.com/zebra.png',
    fly_id: 'cat-zebra',
  },
];

const catalog: FlyCatalog[] = [
  { id: 'cat-royal', name: 'Royal Wulff', type: 'dry', photo_url: null, presentation: null },
  { id: 'cat-zebra', name: 'Zebra Midge', type: 'nymph', photo_url: null, presentation: null },
];

describe('findUserBoxFlyForSelection', () => {
  it('matches by name and size when color differs between empty string and null', () => {
    const match = findUserBoxFlyForSelection(userFlies, 'Zebra Midge', 12, null);
    expect(match?.id).toBe('box-zebra');
  });
});

describe('seedSelectionFromFlyChange', () => {
  it('resolves secondary rig slot to user box row by name and size', () => {
    const seeded = seedSelectionFromFlyChange(
      { pattern: 'Zebra Midge', size: 12, color: null },
      userFlies,
      catalog,
    );
    expect(seeded.userBoxId).toBe('box-zebra');
    expect(seeded.catalogFlyId).toBeNull();
  });

  it('prefers user box row when catalog id matches an owned fly', () => {
    const seeded = seedSelectionFromFlyChange(
      { pattern: 'Zebra Midge', size: 12, color: null, fly_id: 'cat-zebra' },
      userFlies,
      catalog,
    );
    expect(seeded.userBoxId).toBe('box-zebra');
  });
});

describe('isSameFlyChangeSelection', () => {
  it('treats empty color and null as equivalent', () => {
    expect(
      isSameFlyChangeSelection(
        { pattern: 'Zebra Midge', size: 12, color: null },
        { pattern: 'Zebra Midge', size: 12, color: '' },
      ),
    ).toBe(true);
  });

  it('returns false when pattern differs', () => {
    expect(
      isSameFlyChangeSelection(
        { pattern: 'Royal Wulff', size: 18, color: null },
        { pattern: 'Zebra Midge', size: 12, color: null },
      ),
    ).toBe(false);
  });

  it('matches same pattern when one side omitted size (rig vs box row)', () => {
    expect(
      isSameFlyChangeSelection(
        { pattern: 'Zebra Midge', size: 12, color: null, user_fly_box_id: 'box-zebra' },
        { pattern: 'Zebra Midge', size: null, color: null },
      ),
    ).toBe(true);
  });

  it('matches by user_fly_box_id even when size differs', () => {
    expect(
      isSameFlyChangeSelection(
        { pattern: 'Zebra Midge', size: 12, color: null, user_fly_box_id: 'box-zebra' },
        { pattern: 'Zebra Midge', size: 14, color: null, user_fly_box_id: 'box-zebra' },
      ),
    ).toBe(true);
  });
});
