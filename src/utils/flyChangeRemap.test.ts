import { describe, expect, it } from 'vitest';
import { bundledCatalogIdForName, getBundledFlyCatalog, isBundledCatalogFlyId } from '@/src/constants/bundledFlyCatalog';
import { remapFlyChangeDataBoxIds, type FlyBoxRemapEntry } from '@/src/utils/flyChangeRemap';
import type { Fly } from '@/src/types';

describe('bundledFlyCatalog', () => {
  it('builds stable bundle ids', () => {
    expect(bundledCatalogIdForName('Zebra Midge')).toBe('bundle:zebra-midge');
    expect(isBundledCatalogFlyId('bundle:adams')).toBe(true);
    expect(isBundledCatalogFlyId('uuid-here')).toBe(false);
  });

  it('includes common flies offline', () => {
    const catalog = getBundledFlyCatalog();
    expect(catalog.some((c) => c.name === 'Adams')).toBe(true);
    expect(catalog.every((c) => c.id.startsWith('bundle:'))).toBe(true);
  });
});

describe('remapFlyChangeDataBoxIds', () => {
  it('rewrites pg_* box id and local photo snapshot', () => {
    const serverFly: Fly = {
      id: 'server-box-1',
      user_id: 'user-1',
      name: 'Adams',
      type: 'fly',
      size: 16,
      color: 'Gray',
      photo_url: 'https://example.com/fly.jpg',
      presentation: 'dry',
      quantity: 1,
      fly_id: 'cat-1',
    };
    const localUri = 'file:///pending/photo.jpg';
    const idMap = new Map<string, FlyBoxRemapEntry>([
      ['pg_client', { serverFly, localPhotoUri: localUri }],
    ]);

    const remapped = remapFlyChangeDataBoxIds(
      {
        pattern: 'Adams',
        size: 16,
        color: 'Gray',
        user_fly_box_id: 'pg_client',
        photo_url: localUri,
      },
      idMap,
    );

    expect(remapped.user_fly_box_id).toBe('server-box-1');
    expect(remapped.photo_url).toBe('https://example.com/fly.jpg');
  });
});
