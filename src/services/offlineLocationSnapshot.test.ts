import { describe, expect, it } from 'vitest';
import type { Location } from '@/src/types';
import {
  OFFLINE_SNAPSHOT_FALLBACK_LIMIT,
  buildOfflineLocationSnapshot,
} from './offlineLocationSnapshot';

function loc(partial: Partial<Location> & Pick<Location, 'id'>): Location {
  return {
    name: partial.id,
    type: 'river',
    parent_location_id: null,
    latitude: null,
    longitude: null,
    metadata: null,
    ...partial,
  } as Location;
}

// Inside Utah's bounding box (lat 36.99–42, lng -114.05 to -109.04).
const utahPoint = loc({ id: 'provo', latitude: 40.23, longitude: -111.66 });
// Well outside Utah (somewhere in Europe).
const foreignPoint = loc({ id: 'seine', latitude: 48.85, longitude: 2.35 });

describe('buildOfflineLocationSnapshot', () => {
  it('filters by state bbox for a US profile (state present)', () => {
    const out = buildOfflineLocationSnapshot([utahPoint, foreignPoint], {
      homeState: 'Utah',
      homeCountry: 'United States',
    });
    expect(out.map((l) => l.id)).toEqual(['provo']);
  });

  it('also filters when only a 2-letter state code is stored', () => {
    const out = buildOfflineLocationSnapshot([utahPoint, foreignPoint], {
      homeState: 'UT',
    });
    expect(out.map((l) => l.id)).toEqual(['provo']);
  });

  it('degrades to the full active list for a non-US profile (no usable state)', () => {
    const out = buildOfflineLocationSnapshot([utahPoint, foreignPoint], {
      homeCountry: 'France',
    });
    expect(out.map((l) => l.id).sort()).toEqual(['provo', 'seine']);
  });

  it('falls back when state is blank/unresolvable rather than returning nothing', () => {
    const out = buildOfflineLocationSnapshot([utahPoint, foreignPoint], {
      homeState: '   ',
      homeCountry: '',
    });
    expect(out).toHaveLength(2);
  });

  it('excludes soft-deleted rows in the fallback path', () => {
    const deleted = loc({ id: 'gone', deleted_at: '2026-01-01T00:00:00Z' });
    const out = buildOfflineLocationSnapshot([utahPoint, deleted], { homeCountry: 'Japan' });
    expect(out.map((l) => l.id)).toEqual(['provo']);
  });

  it('caps the fallback snapshot to keep it small', () => {
    const many = Array.from({ length: OFFLINE_SNAPSHOT_FALLBACK_LIMIT + 50 }, (_, i) =>
      loc({ id: `loc-${i}`, latitude: 1, longitude: 1 }),
    );
    const out = buildOfflineLocationSnapshot(many, { homeCountry: 'Australia' });
    expect(out).toHaveLength(OFFLINE_SNAPSHOT_FALLBACK_LIMIT);
  });
});
