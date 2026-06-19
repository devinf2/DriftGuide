import { describe, expect, it } from 'vitest';
import { routeForNotificationData } from './notificationRouting';

const UUID = '0a8f1c2d-3b4e-4f56-8a9b-0c1d2e3f4a5b';

describe('routeForNotificationData', () => {
  it('routes trip reminders / log-catches to the trip summary', () => {
    expect(routeForNotificationData({ type: 'trip_reminder', tripId: UUID })).toBe(
      `/trip/${UUID}/summary`,
    );
    expect(routeForNotificationData({ type: 'log_catches', tripId: UUID })).toBe(
      `/trip/${UUID}/summary`,
    );
  });

  it('routes conditions to the spot screen', () => {
    expect(routeForNotificationData({ type: 'conditions', spotId: UUID })).toBe(`/spot/${UUID}`);
  });

  it('routes friend activity to the feed', () => {
    expect(routeForNotificationData({ type: 'post_created' })).toBe('/friends');
    expect(routeForNotificationData({ type: 'post_reaction' })).toBe('/friends');
  });

  it('routes friend requests to the Requests tab', () => {
    expect(routeForNotificationData({ type: 'friend_request', actorId: UUID })).toBe(
      '/friends/manage?seg=requests',
    );
  });

  it('routes friend accepts to the new friend profile, falling back when the id is bad', () => {
    expect(routeForNotificationData({ type: 'friend_accept', actorId: UUID })).toBe(
      `/profile/friend/${UUID}`,
    );
    expect(routeForNotificationData({ type: 'friend_accept', actorId: 'nope' })).toBe(
      '/friends/manage',
    );
    expect(routeForNotificationData({ type: 'friend_accept' })).toBe('/friends/manage');
  });

  it('routes stats payloads to the stats screen', () => {
    expect(routeForNotificationData({ type: 'stats' })).toBe('/profile/stats');
  });

  it('rejects non-UUID ids (mirrors deep-link validation)', () => {
    expect(routeForNotificationData({ type: 'trip_reminder', tripId: 'abc' })).toBeNull();
    expect(routeForNotificationData({ type: 'conditions', spotId: '123' })).toBeNull();
  });

  it('returns null for unknown / empty payloads', () => {
    expect(routeForNotificationData(null)).toBeNull();
    expect(routeForNotificationData(undefined)).toBeNull();
    expect(routeForNotificationData({})).toBeNull();
    expect(routeForNotificationData({ type: 'wat' })).toBeNull();
  });
});
