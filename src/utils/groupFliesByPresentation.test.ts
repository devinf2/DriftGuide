import { describe, expect, it } from 'vitest';
import type { Fly, FlyCatalog } from '@/src/types';
import {
  groupItemsByPresentation,
  resolveCatalogFlyPresentation,
  resolveUserFlyPresentation,
} from '@/src/utils/groupFliesByPresentation';

describe('groupFliesByPresentation', () => {
  const catalog: FlyCatalog[] = [
    { id: 'c-adams', name: 'Adams', type: 'fly', photo_url: null, presentation: 'dry' },
    { id: 'c-pt', name: 'Pheasant Tail Nymph', type: 'fly', photo_url: null, presentation: 'nymph' },
    { id: 'c-bugger', name: 'Woolly Bugger', type: 'fly', photo_url: null, presentation: 'streamer' },
  ];

  it('groups catalog flies in presentation order', () => {
    const sections = groupItemsByPresentation(
      catalog,
      resolveCatalogFlyPresentation,
      (a, b) => a.name.localeCompare(b.name),
    );
    expect(sections.map((s) => s.key)).toEqual(['dry', 'nymph', 'streamer']);
    expect(sections[0]?.items.map((f) => f.name)).toEqual(['Adams']);
  });

  it('resolves user fly presentation from catalog link', () => {
    const fly: Fly = {
      id: 'u-1',
      name: 'Adams',
      type: 'fly',
      size: 14,
      color: 'Gray',
      photo_url: null,
      fly_id: 'c-adams',
    };
    expect(resolveUserFlyPresentation(fly, catalog)).toBe('dry');
  });

  it('puts unknown presentations in Other', () => {
    const unknown: FlyCatalog = {
      id: 'c-x',
      name: 'Mystery Fly',
      type: 'fly',
      photo_url: null,
      presentation: null,
    };
    const sections = groupItemsByPresentation([unknown], resolveCatalogFlyPresentation);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.key).toBe('other');
  });
});
