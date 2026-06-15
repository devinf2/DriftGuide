import { describe, expect, it } from 'vitest';
import { INSECTS, allReferencedFlyNames, fliesForInsect } from '@/src/data/insects';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import {
  availableSizeBuckets,
  filterInsects,
} from '@/src/utils/bugMatcherFilter';

describe('insects dataset', () => {
  it('every referenced fly name resolves to a bundled image', () => {
    const unresolved = allReferencedFlyNames().filter((name) => getBundledFlyImageSource(name) == null);
    expect(unresolved).toEqual([]);
  });

  it('each insect has at least one life stage with matching flies', () => {
    for (const insect of INSECTS) {
      expect(fliesForInsect(insect).length).toBeGreaterThan(0);
    }
  });

  it('has unique insect ids', () => {
    const ids = INSECTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('offline feature key narrowing', () => {
  it('narrows a tiny black midge-cluster to the Midge', () => {
    const results = filterInsects({
      category: 'midge',
      color: 'black',
      profile: 'cluster',
    });
    expect(results.map((i) => i.id)).toEqual(['midge']);
  });

  it('narrows a large orange-and-black stonefly with flat wings to the Salmonfly', () => {
    const results = filterInsects({
      category: 'stone',
      size: 'large',
      color: 'orange',
      profile: 'flat-wing',
    });
    expect(results.map((i) => i.id)).toEqual(['salmonfly']);
  });

  it('size buckets overlap by range (a #16-22 BWO matches both small and tiny)', () => {
    const buckets = availableSizeBuckets({ category: 'mayfly' });
    expect(buckets).toContain('tiny');
    expect(buckets).toContain('small');
  });

  it('returns multiple mayfly candidates with only a category filter', () => {
    const results = filterInsects({ category: 'mayfly' });
    expect(results.length).toBeGreaterThan(3);
  });

  it('empty filters returns the whole dataset', () => {
    expect(filterInsects({})).toHaveLength(INSECTS.length);
  });
});
