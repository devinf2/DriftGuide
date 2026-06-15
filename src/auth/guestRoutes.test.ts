import { describe, expect, it } from 'vitest';

import { GUEST_ALLOWED_SEGMENTS, isGuestAllowedRoute } from './guestRoutes';

describe('isGuestAllowedRoute', () => {
  it('allows the root/index route (resolves into the tabs group)', () => {
    expect(isGuestAllowedRoute([])).toBe(true);
  });

  it('allows the (tabs) group and its nested screens', () => {
    expect(isGuestAllowedRoute(['(tabs)'])).toBe(true);
    expect(isGuestAllowedRoute(['(tabs)', 'home'])).toBe(true);
    expect(isGuestAllowedRoute(['(tabs)', 'map'])).toBe(true);
    expect(isGuestAllowedRoute(['(tabs)', 'guide'])).toBe(true);
    // Hatch calendar lives under the home tab.
    expect(isGuestAllowedRoute(['(tabs)', 'home', 'hatch-chart'])).toBe(true);
  });

  it('allows spot detail (read-only) for guests', () => {
    expect(isGuestAllowedRoute(['spot', '[id]'])).toBe(true);
  });

  it('allows the auth screen itself (contextual sheet + cold-start)', () => {
    expect(isGuestAllowedRoute(['auth'])).toBe(true);
    expect(isGuestAllowedRoute(['auth', 'reset-password'])).toBe(true);
  });

  it('blocks account-bound trip routes', () => {
    expect(isGuestAllowedRoute(['trip', 'fish-now'])).toBe(false);
    expect(isGuestAllowedRoute(['trip', 'new'])).toBe(false);
    expect(isGuestAllowedRoute(['trip', 'import-past'])).toBe(false);
    expect(isGuestAllowedRoute(['trip', '[id]'])).toBe(false);
  });

  it('blocks other account-bound surfaces', () => {
    expect(isGuestAllowedRoute(['onboarding'])).toBe(false);
    expect(isGuestAllowedRoute(['photos'])).toBe(false);
    expect(isGuestAllowedRoute(['fly-box'])).toBe(false);
    expect(isGuestAllowedRoute(['session', 'link-trip'])).toBe(false);
  });

  it('blocks unknown top-level segments by default (fail closed)', () => {
    expect(isGuestAllowedRoute(['some-future-private-route'])).toBe(false);
  });

  it('only allows exactly the documented segments', () => {
    expect([...GUEST_ALLOWED_SEGMENTS].sort()).toEqual(['(tabs)', 'auth', 'spot']);
  });
});
