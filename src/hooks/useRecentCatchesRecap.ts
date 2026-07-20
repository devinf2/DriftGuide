/**
 * Data hook for the Fish home "Welcome" section's look-back:
 * the signed-in user's most recent catches plus their last completed trip.
 *
 * Mirrors the self-contained pattern of {@link useStreakMilestoneSummary}: it fetches
 * the same trips + catches lists from the cloud so the Welcome card only needs to render.
 * The two hooks intentionally fetch independently to stay modular; the payloads are small
 * and cached by the network layer.
 */
import { useCallback, useEffect, useState } from 'react';

import { fetchTripsFromCloud, fetchUserCatchesFromCloud } from '@/src/services/sync';
import { useAuthStore } from '@/src/stores/authStore';
import type { CatchRow, Trip } from '@/src/types';

/** How many recent catches the Welcome strip shows before "See all". */
export const RECENT_CATCHES_LIMIT = 10;

/** Milliseconds in a day — used for the daily spotlight seed and throwback ages. */
const DAY_MS = 86_400_000;
/** A catch must be at least this old to be resurfaced as a "throwback" spotlight. */
const THROWBACK_MIN_MS = 30 * DAY_MS;

/**
 * One featured "Catch Spotlight" pick for the Welcome tab. The pick rotates once
 * per day (see {@link buildDailySpotlight}) and carries a human reason so the card
 * reads as a moment ("Your best from your last trip") rather than a bare photo.
 */
export interface CatchSpotlight {
  catch: CatchRow;
  /** Caption line explaining why this catch is featured today. */
  reason: string;
  /** Trip location name when hydrated, else null. */
  locationName: string | null;
}

export interface RecentCatchesRecap {
  /** Most recent catches, newest first (up to {@link RECENT_CATCHES_LIMIT}). */
  recentCatches: CatchRow[];
  /** Total catches on record (drives the "See all" affordance / counts). */
  totalCatches: number;
  /** Most recent completed trip, with `location` hydrated when available. */
  lastTrip: Trip | null;
  /** Today's rotating featured catch, or null when there are no photo catches. */
  spotlight: CatchSpotlight | null;
  /** Trip id → location name, so a promoted strip catch can show its place. */
  locationNameByTripId: Record<string, string | null>;
  loading: boolean;
  refresh: () => void;
}

function hasPhoto(c: CatchRow): boolean {
  return Boolean(c.photo_url) || (Array.isArray(c.photo_urls) && c.photo_urls.length > 0);
}

/** "2 years ago" / "5 months ago" / "A while back" for a throwback catch. */
function throwbackLabel(timestamp: string): string {
  const days = Math.floor((Date.now() - new Date(timestamp).getTime()) / DAY_MS);
  if (days >= 365) {
    const y = Math.floor(days / 365);
    return `${y} year${y > 1 ? 's' : ''} ago`;
  }
  if (days >= 60) {
    return `${Math.floor(days / 30)} months ago`;
  }
  return 'A while back';
}

/**
 * Assemble the candidate pool of catches worth featuring, each tagged with its reason.
 * Order is deterministic given the same data so the daily index cycles predictably.
 * Candidates are de-duped by catch id (a catch can qualify for several reasons).
 */
function buildSpotlightPool(catches: CatchRow[], trips: Trip[]): CatchSpotlight[] {
  const withPhoto = catches.filter(hasPhoto);
  if (withPhoto.length === 0) return [];

  const tripsById = new Map(trips.map((t) => [t.id, t]));
  const locName = (c: CatchRow) => tripsById.get(c.trip_id)?.location?.name ?? null;
  const sized = withPhoto.filter((c) => c.size_inches != null);

  const pool: CatchSpotlight[] = [];
  const seen = new Set<string>();
  const add = (c: CatchRow | undefined, reason: string) => {
    if (!c || seen.has(c.id)) return;
    seen.add(c.id);
    pool.push({ catch: c, reason, locationName: locName(c) });
  };

  // 1. Best fish (by size) from the most recent completed trip.
  const lastTrip = trips.find((t) => t.status === 'completed');
  if (lastTrip) {
    const fromLast = withPhoto.filter((c) => c.trip_id === lastTrip.id);
    const best =
      [...fromLast]
        .filter((c) => c.size_inches != null)
        .sort((a, b) => (b.size_inches ?? 0) - (a.size_inches ?? 0))[0] ?? fromLast[0];
    add(best, 'Your best from your last trip');
  }

  // 2. Personal best per species (biggest of each kind on record).
  const bySpecies = new Map<string, CatchRow>();
  for (const c of sized) {
    const key = (c.species ?? '').toLowerCase().trim();
    if (!key) continue;
    const cur = bySpecies.get(key);
    if (!cur || (c.size_inches ?? 0) > (cur.size_inches ?? 0)) bySpecies.set(key, c);
  }
  for (const c of bySpecies.values()) add(c, `Still your biggest ${c.species}`);

  // 3. A few throwbacks (older than a month) for nostalgia.
  const throwbacks = withPhoto.filter(
    (c) => Date.now() - new Date(c.timestamp).getTime() > THROWBACK_MIN_MS,
  );
  for (const c of throwbacks.slice(0, 4)) add(c, throwbackLabel(c.timestamp));

  // 4. Fallback gems so the pool is never empty when photos exist.
  for (const c of withPhoto.slice(0, 6)) add(c, 'Remember this one?');

  return pool;
}

/**
 * Pick today's spotlight from the pool. The seed is the current day number, so the
 * choice holds for 24h ("catch of the day") and advances to the next candidate daily,
 * cycling through the whole pool over time.
 */
function buildDailySpotlight(catches: CatchRow[], trips: Trip[]): CatchSpotlight | null {
  const pool = buildSpotlightPool(catches, trips);
  if (pool.length === 0) return null;
  const daySeed = Math.floor(Date.now() / DAY_MS);
  return pool[daySeed % pool.length];
}

export function useRecentCatchesRecap(refreshKey = 0): RecentCatchesRecap {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [recentCatches, setRecentCatches] = useState<CatchRow[]>([]);
  const [totalCatches, setTotalCatches] = useState(0);
  const [lastTrip, setLastTrip] = useState<Trip | null>(null);
  const [spotlight, setSpotlight] = useState<CatchSpotlight | null>(null);
  const [locationNameByTripId, setLocationNameByTripId] = useState<Record<string, string | null>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [manualKey, setManualKey] = useState(0);

  const refresh = useCallback(() => setManualKey((k) => k + 1), []);

  const load = useCallback(async (uid: string) => {
    setLoading(true);
    try {
      const [trips, catches] = await Promise.all([
        fetchTripsFromCloud(uid),
        fetchUserCatchesFromCloud(uid),
      ]);
      // fetchUserCatchesFromCloud already returns newest-first; guard anyway.
      const sorted = [...catches].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      // Welcome only surfaces catches that have a photo.
      const withPhoto = sorted.filter(hasPhoto);
      setRecentCatches(withPhoto.slice(0, RECENT_CATCHES_LIMIT));
      setTotalCatches(sorted.length);
      // fetchTripsFromCloud returns start_time desc; first completed trip is the latest.
      setLastTrip(trips.find((t) => t.status === 'completed') ?? null);
      setSpotlight(buildDailySpotlight(sorted, trips));
      setLocationNameByTripId(
        Object.fromEntries(trips.map((t) => [t.id, t.location?.name ?? null])),
      );
    } catch (err) {
      console.warn('[useRecentCatchesRecap] load failed', err);
      setRecentCatches([]);
      setTotalCatches(0);
      setLastTrip(null);
      setSpotlight(null);
      setLocationNameByTripId({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setRecentCatches([]);
      setTotalCatches(0);
      setLastTrip(null);
      setSpotlight(null);
      setLocationNameByTripId({});
      return;
    }
    void load(userId);
  }, [userId, load, refreshKey, manualKey]);

  return {
    recentCatches,
    totalCatches,
    lastTrip,
    spotlight,
    locationNameByTripId,
    loading,
    refresh,
  };
}
