import { describe, expect, it } from 'vitest';
import type { CommunityCatchRow } from '@/src/types';
import type { DownloadedWaterway } from '@/src/services/waterwayCache';
import {
  basePatternFromRigDisplay,
  buildActivityPaceForOffline,
  buildOfflinePackAggregatesFromDownloads,
  buildRigAndSavedDataParagraph,
  buildTopThreeUnifiedFliesParagraph,
  filterCommunityRowsForOfflineIntel,
  findMatchingDownloadedBundles,
  isExcludedOfflineFlyPattern,
  patternStrengthFromWeightMap,
  timeOfDayBucket,
  type GuideOfflinePackAggregates,
} from '@/src/services/offlineGuideLocalIntel';

describe('timeOfDayBucket', () => {
  it('maps hours to buckets', () => {
    expect(timeOfDayBucket(new Date('2020-01-01T07:00:00'))).toBe('early morning');
    expect(timeOfDayBucket(new Date('2020-01-01T13:00:00'))).toBe('midday');
  });
});

describe('isExcludedOfflineFlyPattern', () => {
  it('excludes Other', () => {
    expect(isExcludedOfflineFlyPattern('Other')).toBe(true);
    expect(isExcludedOfflineFlyPattern('Pheasant Tail')).toBe(false);
  });
});

describe('findMatchingDownloadedBundles', () => {
  const bbox = {
    ne: { lat: 41, lng: -111 },
    sw: { lat: 40, lng: -112 },
  };

  it('matches by catalog location id', () => {
    const w: DownloadedWaterway = {
      locationId: 'pack-1',
      locationIds: ['loc-a'],
      locations: [],
      conditions: {},
      communityCatches: [],
      conditionsSnapshots: [],
      downloadedAt: '',
      lastRefreshedAt: '',
      downloadBbox: bbox,
    };
    expect(findMatchingDownloadedBundles([w], { locationIds: ['loc-a'], lat: null, lng: null })).toEqual([w]);
  });
});

describe('filterCommunityRowsForOfflineIntel', () => {
  const since = '2025-01-01T00:00:00.000Z';
  const rows: CommunityCatchRow[] = [
    {
      id: '1',
      location_id: 'L1',
      latitude: null,
      longitude: null,
      timestamp: '2025-06-01T12:00:00.000Z',
      species: null,
      size_inches: null,
      quantity: 1,
      released: null,
      depth_ft: 2,
      structure: null,
      caught_on_fly: null,
      fly_pattern: 'Parachute Adams',
      fly_size: 16,
      fly_color: null,
      presentation_method: 'dry fly',
      conditions_snapshot_id: null,
      note: null,
    },
  ];

  it('filters by location id set', () => {
    const out = filterCommunityRowsForOfflineIntel(rows, ['L1'], since);
    expect(out).toHaveLength(1);
  });
});

describe('buildOfflinePackAggregatesFromDownloads', () => {
  it('returns null when no bundles match', () => {
    expect(
      buildOfflinePackAggregatesFromDownloads([], {
        locationIds: ['x'],
        userId: 'u1',
        userLat: null,
        userLng: null,
        refDate: new Date('2025-06-15T14:00:00'),
        refBucket: 'afternoon',
      }),
    ).toBeNull();
  });

  it('excludes Other from top flies and builds pattern weights', () => {
    const w: DownloadedWaterway = {
      locationId: 'p1',
      locationIds: ['L1'],
      locations: [],
      conditions: {},
      communityCatches: [
        {
          id: 'c1',
          location_id: 'L1',
          latitude: null,
          longitude: null,
          timestamp: '2025-06-15T14:00:00.000Z',
          species: null,
          size_inches: null,
          quantity: 2,
          released: null,
          depth_ft: null,
          structure: null,
          caught_on_fly: null,
          fly_pattern: 'Other',
          fly_size: 14,
          fly_color: null,
          presentation_method: 'dry fly',
          conditions_snapshot_id: null,
          note: null,
        },
        {
          id: 'c2',
          location_id: 'L1',
          latitude: null,
          longitude: null,
          timestamp: '2025-06-15T15:00:00.000Z',
          species: null,
          size_inches: null,
          quantity: 4,
          released: null,
          depth_ft: null,
          structure: null,
          caught_on_fly: null,
          fly_pattern: 'Zebra Midge',
          fly_size: 20,
          fly_color: 'Black',
          presentation_method: 'nymph',
          conditions_snapshot_id: null,
          note: null,
        },
      ],
      conditionsSnapshots: [],
      downloadedAt: '',
      lastRefreshedAt: '',
    };
    const agg = buildOfflinePackAggregatesFromDownloads([w], {
      locationIds: ['L1'],
      userId: null,
      userLat: null,
      userLng: null,
      refDate: new Date('2025-06-15T16:00:00'),
      refBucket: 'afternoon',
    });
    expect(agg).not.toBeNull();
    expect(agg!.topFlies.length).toBe(1);
    expect(agg!.topFlies[0].label).toContain('Zebra Midge');
    expect(agg!.patternWeightByKey['zebra midge']).toBeGreaterThan(0);
    expect(agg!.dominantPresentationOverall).toBe('nymph');
  });
});

describe('patternStrengthFromWeightMap', () => {
  it('grades by weight', () => {
    expect(patternStrengthFromWeightMap('zebra midge', { 'zebra midge': 15 })).toBe('strong');
    expect(patternStrengthFromWeightMap('zebra midge', { 'zebra midge': 5 })).toBe('good');
    expect(patternStrengthFromWeightMap('zebra midge', { 'zebra midge': 1 })).toBe('low');
    expect(patternStrengthFromWeightMap('missing', {})).toBe('none');
  });
});

describe('basePatternFromRigDisplay', () => {
  it('strips size and color', () => {
    expect(basePatternFromRigDisplay('Blue Wing Olive #18 (Olive)')).toBe('blue wing olive');
  });
});

describe('buildActivityPaceForOffline', () => {
  it('falls back when sample is thin', () => {
    const t = buildActivityPaceForOffline('midday', { midday: 1 });
    expect(t.toLowerCase()).toContain('thin');
  });
});

describe('buildTopThreeUnifiedFliesParagraph', () => {
  it('formats list', () => {
    const text = buildTopThreeUnifiedFliesParagraph({
      topFlies: [{ label: 'PT #18', presentation: 'nymph' }],
      bucketWeights: {},
      patternWeightByKey: {},
      dominantPresentationOverall: null,
    });
    expect(text).toContain('PT #18');
    expect(text).toContain('nymph');
  });
});

describe('buildRigAndSavedDataParagraph', () => {
  it('handles no rig', () => {
    const t = buildRigAndSavedDataParagraph(null, null, null, null);
    expect(t).toContain('haven’t set flies');
  });

  it('uses area presentation, timing, and cached weather when exact fly has no log match', () => {
    const agg: GuideOfflinePackAggregates = {
      topFlies: [{ label: 'Zebra Midge #20', presentation: 'nymph' }],
      bucketWeights: { 'early morning': 5, evening: 6, midday: 1 },
      patternWeightByKey: { 'zebra midge': 12 },
      dominantPresentationOverall: 'dry fly',
    };
    const t = buildRigAndSavedDataParagraph(
      'Blue Wing Olive #18',
      'Zebra Midge #20',
      agg,
      { condition: 'Overcast', temperature_f: 52 },
    );
    expect(t).toContain('Blue Wing Olive');
    expect(t).toMatch(/Best fished on the surface|surface|Cached weather|Overcast|52/i);
    expect(t).toContain('Zebra Midge');
    expect(t).toMatch(/strong|decent/i);
  });
});
