import { describe, expect, it } from 'vitest';
import {
  COUNTRIES,
  US_COUNTRY_CODE,
  isUsCountry,
  matchStoredHomeCountry,
} from './countries';

describe('COUNTRIES dataset', () => {
  it('has unique ISO codes', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses 2-letter alpha-2 codes', () => {
    for (const c of COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('has a non-empty name for every entry', () => {
    for (const c of COUNTRIES) {
      expect(c.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('includes the United States with the canonical code', () => {
    const us = COUNTRIES.find((c) => c.code === US_COUNTRY_CODE);
    expect(us).toBeDefined();
    expect(us?.name).toBe('United States');
  });

  it('includes a broad international set (sanity check on size)', () => {
    expect(COUNTRIES.length).toBeGreaterThan(190);
  });

  it('has unique names', () => {
    const names = COUNTRIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('matchStoredHomeCountry', () => {
  it('matches by code (case-insensitive)', () => {
    expect(matchStoredHomeCountry('us')?.code).toBe('US');
    expect(matchStoredHomeCountry('US')?.code).toBe('US');
  });

  it('matches by full name (case-insensitive)', () => {
    expect(matchStoredHomeCountry('united states')?.code).toBe('US');
    expect(matchStoredHomeCountry('Canada')?.code).toBe('CA');
  });

  it('returns null for empty or unknown values', () => {
    expect(matchStoredHomeCountry(null)).toBeNull();
    expect(matchStoredHomeCountry('   ')).toBeNull();
    expect(matchStoredHomeCountry('Atlantis')).toBeNull();
  });
});

describe('isUsCountry', () => {
  it('is true only for the US code (case/space-insensitive)', () => {
    expect(isUsCountry('US')).toBe(true);
    expect(isUsCountry(' us ')).toBe(true);
    expect(isUsCountry('CA')).toBe(false);
    expect(isUsCountry(null)).toBe(false);
    expect(isUsCountry(undefined)).toBe(false);
  });
});
