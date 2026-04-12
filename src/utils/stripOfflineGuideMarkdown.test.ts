import { describe, expect, it } from 'vitest';
import { stripOfflineGuideMarkdown } from './stripOfflineGuideMarkdown';

describe('stripOfflineGuideMarkdown', () => {
  it('removes heading hashes and bold markers', () => {
    const s = stripOfflineGuideMarkdown(`## Title\n\nHello **world** here.`);
    expect(s).not.toContain('#');
    expect(s).not.toContain('*');
    expect(s).toContain('Title');
    expect(s).toContain('Hello world here');
  });

  it('normalizes list markers', () => {
    expect(stripOfflineGuideMarkdown('- One')).toContain('• One');
  });

  it('removes stray ** after paired bold is stripped', () => {
    expect(stripOfflineGuideMarkdown('**a** and ** orphan')).toBe('a and  orphan');
  });
});
