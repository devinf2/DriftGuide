import { describe, expect, it } from 'vitest';
import { validateProfileOnboarding } from './profileOnboarding';

describe('validateProfileOnboarding', () => {
  it('passes with names + country and no region', () => {
    expect(
      validateProfileOnboarding({
        firstName: 'Jane',
        lastName: 'Angler',
        homeCountry: 'United States',
      }),
    ).toEqual({ error: null });
  });

  it('passes with a region provided', () => {
    expect(
      validateProfileOnboarding({
        firstName: 'Jane',
        lastName: 'Angler',
        homeCountry: 'Canada',
        homeRegion: 'British Columbia',
      }),
    ).toEqual({ error: null });
  });

  it('requires first and last name', () => {
    expect(
      validateProfileOnboarding({ firstName: '  ', lastName: 'Angler', homeCountry: 'US' }).error,
    ).toMatch(/first and last name/i);
    expect(
      validateProfileOnboarding({ firstName: 'Jane', lastName: '', homeCountry: 'US' }).error,
    ).toMatch(/first and last name/i);
  });

  it('requires a country', () => {
    expect(
      validateProfileOnboarding({ firstName: 'Jane', lastName: 'Angler', homeCountry: '   ' }).error,
    ).toMatch(/country/i);
  });

  it('treats region as optional (blank is fine)', () => {
    expect(
      validateProfileOnboarding({
        firstName: 'Jane',
        lastName: 'Angler',
        homeCountry: 'France',
        homeRegion: '',
      }),
    ).toEqual({ error: null });
  });
});
