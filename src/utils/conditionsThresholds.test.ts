import { describe, expect, it } from 'vitest';
import {
  CONDITIONS_THRESHOLDS,
  conditionsPushBody,
  evaluateConditions,
} from './conditionsThresholds';

describe('evaluateConditions', () => {
  it('flags a clearly good window (multiple aligned signals)', () => {
    const r = evaluateConditions({
      tempF: 62,
      windMph: 5,
      waterTempF: 55,
      clarity: 'clear',
    });
    expect(r.isGoodWindow).toBe(true);
    expect(r.disqualified).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(CONDITIONS_THRESHOLDS.MIN_GOOD_SCORE);
  });

  it('disqualifies on gale-force wind regardless of other signals', () => {
    const r = evaluateConditions({
      tempF: 62,
      windMph: 30,
      waterTempF: 55,
      clarity: 'clear',
    });
    expect(r.isGoodWindow).toBe(false);
    expect(r.disqualified).toBe(true);
  });

  it('disqualifies on blown-out water', () => {
    const r = evaluateConditions({
      tempF: 62,
      windMph: 4,
      waterTempF: 55,
      clarity: 'blown_out',
    });
    expect(r.isGoodWindow).toBe(false);
    expect(r.disqualified).toBe(true);
  });

  it('requires more than one positive signal', () => {
    // Only light wind qualifies; everything else out of range / unknown.
    const r = evaluateConditions({
      tempF: 100, // too hot
      windMph: 3, // light wind = 1 point
      waterTempF: 80, // too warm
      clarity: 'unknown', // not in GOOD list
    });
    expect(r.score).toBe(1);
    expect(r.isGoodWindow).toBe(false);
  });

  it('handles missing fields gracefully', () => {
    const r = evaluateConditions({});
    expect(r.score).toBe(0);
    expect(r.isGoodWindow).toBe(false);
    expect(r.disqualified).toBe(false);
  });

  it('respects the air- and water-temp bounds', () => {
    const low = evaluateConditions({ tempF: 40, waterTempF: 40, windMph: 2, clarity: 'clear' });
    // air & water below min -> only light wind + clarity count = 2
    expect(low.score).toBe(2);
    expect(low.isGoodWindow).toBe(true);
  });
});

describe('conditionsPushBody', () => {
  it('includes the water name', () => {
    expect(conditionsPushBody('Provo River')).toContain('Provo River');
  });
});
