import { describe, expect, it } from 'vitest';
import { getHatchModalDetailCopy, resolveInsectToChartId } from '@/src/utils/hatchModalEnrichment';

describe('resolveInsectToChartId', () => {
  it('maps common BWO spellings', () => {
    expect(resolveInsectToChartId('Blue Wing Olive')).toBe('bwo');
    expect(resolveInsectToChartId('Blue-Winged Olive')).toBe('bwo');
    expect(resolveInsectToChartId('BWO')).toBe('bwo');
    expect(resolveInsectToChartId('Small Baetis')).toBe('bwo');
  });

  it('maps october caddis before generic caddis', () => {
    expect(resolveInsectToChartId('October Caddis')).toBe('oct-caddis');
    expect(resolveInsectToChartId('Tan caddis')).toBe('caddis');
  });
});

describe('getHatchModalDetailCopy', () => {
  it('uses API detail when present', () => {
    const r = getHatchModalDetailCopy({
      insect: 'BWO',
      sizes: '#18',
      status: 'Active',
      tier: 'active',
      detail: 'Custom paragraph from model.',
    });
    expect(r.source).toBe('api');
    expect(r.text).toContain('Custom paragraph');
  });

  it('uses tight calendar copy when detail missing', () => {
    const r = getHatchModalDetailCopy({
      insect: 'Blue Wing Olive',
      sizes: '#18-20',
      status: 'Active',
      tier: 'active',
    });
    expect(r.source).toBe('calendar');
    expect(r.text).toContain('Spring & fall');
    expect(r.text).toMatch(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December): (prime|solid|thin|quiet) on the chart/,
    );
    expect(r.text).toContain('Seams');
    expect(r.text).toContain('spinners');
    expect(r.text).not.toMatch(/briefing lists/i);
    expect(r.text.length).toBeLessThan(350);
  });
});
