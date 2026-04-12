import { describe, expect, it } from 'vitest';
import { buildOfflineGuideSections } from '@/src/services/offlineGuideReplySections';
import type { OfflineGuideSectionContext } from '@/src/services/offlineGuideReplySections';
import type { Location, WaterFlowData } from '@/src/types';

function minimalLocation(): Location {
  return {
    id: 'loc-1',
    name: 'Test River',
    type: 'stream',
    parent_location_id: null,
    latitude: 40.5,
    longitude: -111.5,
    metadata: null,
    is_public: true,
  };
}

function minimalFlow(): WaterFlowData {
  return {
    station_id: 'st',
    station_name: 'Gauge',
    flow_cfs: 120,
    water_temp_f: 48,
    gage_height_ft: null,
    turbidity_ntu: null,
    clarity: 'slightly_stained',
    clarity_source: 'mock',
    timestamp: '2026-01-01T12:00:00Z',
  };
}

describe('buildOfflineGuideSections', () => {
  it('puts intro and rig into currentSetup and activity into bestTimes', () => {
    const ctx: OfflineGuideSectionContext = {
      location: minimalLocation(),
      fishingType: 'fly',
      weather: {
        temperature_f: 58,
        condition: 'Partly Cloudy',
        cloud_cover: 40,
        wind_speed_mph: 6,
        wind_direction: 'W',
        barometric_pressure: 29.92,
        humidity: 45,
      },
      waterFlow: minimalFlow(),
      currentFly: 'Parachute Adams #16',
      currentFly2: null,
      fishCount: 0,
      recentEvents: [],
      timeOfDay: 'late morning',
      season: 'spring',
      guideOfflinePackAggregates: {
        topFlies: [],
        bucketWeights: { 'early morning': 12, 'late morning': 8 },
        patternWeightByKey: {},
        dominantPresentationOverall: null,
      },
    };
    const s = buildOfflineGuideSections(ctx, '');
    expect(s.currentSetup).toContain('Offline guide');
    expect(s.currentSetup).toContain('Parachute Adams');
    expect(s.bestTimes).toContain('Catch timing');
    expect(s.bestTimes).toContain('Cached weather');
    expect(s.bestTimes).toContain('Barometric pressure');
    expect(s.supplementText.length).toBeGreaterThan(50);
    expect(s.fullReplyBeforeNormalize).toContain('Offline guide');
    expect(s.fullReplyBeforeNormalize.split('\n\n').length).toBeGreaterThanOrEqual(3);
  });

  it('joins full reply segments in stable order vs tile buckets', () => {
    const ctx: OfflineGuideSectionContext = {
      location: minimalLocation(),
      fishingType: 'fly',
      weather: null,
      waterFlow: null,
      currentFly: null,
      fishCount: 0,
      recentEvents: [],
      timeOfDay: 'midday',
      season: 'winter',
    };
    const s = buildOfflineGuideSections(ctx, '');
    expect(s.fullReplyBeforeNormalize).toContain(s.bestTimes);
    expect(s.currentSetup).toContain('Offline guide');
  });
});
