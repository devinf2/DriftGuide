import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { v4 as uuidv4 } from 'uuid';

import { edgeFunctionInvokeHeaders, supabase } from '@/src/services/supabase';

/**
 * First-party analytics. Fire-and-forget, never throws, no-ops gracefully offline.
 *
 * Offline strategy: BUFFER. Events that fail to send (offline / backend down) are appended to a
 * bounded ring buffer in AsyncStorage and flushed the next time `track` runs while online, or when
 * connectivity is regained (a NetInfo listener triggers a flush). The buffer is capped at
 * MAX_BUFFERED events so it can never grow without bound; oldest events are dropped first. This is
 * the simpler-robust option vs. a persisted background queue: we never block the UI, never retry in
 * a tight loop, and bound memory/storage.
 *
 * Transport: a Supabase edge function `analytics-ingest` (verify_jwt=false) does a service-role
 * insert so the `analytics_events` table can stay locked down under RLS. Anonymous and authed
 * callers are both accepted.
 */

// ---------------------------------------------------------------------------
// Event name constants — the product funnel. Other workstreams call these as
// their surfaces land; only a few are wired here (see app/_layout, app/spot,
// app/trip/[id]/summary).
// ---------------------------------------------------------------------------
export const AnalyticsEvents = {
  APP_OPEN: 'app_open',
  GUEST_BROWSE: 'guest_browse',
  SPOT_VIEW: 'spot_view',
  GUIDE_QUESTION: 'guide_question',
  HATCH_VIEW: 'hatch_view',
  BUG_MATCH: 'bug_match',
  START_TRIP: 'start_trip',
  FIRST_CATCH: 'first_catch',
  TRIP_COMPLETE: 'trip_complete',
  SIGNUP: 'signup',
  SHARE_SENT: 'share_sent',
  PUSH_OPT_IN: 'push_opt_in',
  FEED_POST: 'feed_post',
  FEED_VIEW: 'feed_view',
} as const;

export type AnalyticsEvent = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

const DEVICE_ID_KEY = 'analytics-device-id';
const BUFFER_KEY = 'analytics-buffer-v1';
const MAX_BUFFERED = 200;
const FUNCTION_NAME = 'analytics-ingest';

type AnalyticsPayload = {
  device_id: string;
  user_id: string | null;
  event: string;
  props: Record<string, unknown>;
  session_id: string;
  platform: string;
  app_version: string;
  // Client-side timestamp; the server also stamps created_at.
  ts: string;
};

// Session id lives for the lifetime of the JS runtime (one app launch).
const SESSION_ID = uuidv4();

let cachedDeviceId: string | null = null;
let deviceIdPromise: Promise<string> | null = null;
let connectivityListenerBound = false;

async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  if (deviceIdPromise) return deviceIdPromise;
  deviceIdPromise = (async () => {
    try {
      const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (existing) {
        cachedDeviceId = existing;
        return existing;
      }
    } catch {
      /* storage unavailable — fall through to a fresh id */
    }
    const fresh = uuidv4();
    cachedDeviceId = fresh;
    try {
      await AsyncStorage.setItem(DEVICE_ID_KEY, fresh);
    } catch {
      /* best-effort persist */
    }
    return fresh;
  })();
  return deviceIdPromise;
}

/**
 * Read the signed-in user id lazily to avoid an import cycle
 * (authStore -> tripStore -> ... -> analytics). A dynamic import keeps authStore out of
 * this module's static import graph; it resolves to the already-loaded module at runtime.
 */
async function getCurrentUserId(): Promise<string | null> {
  try {
    const mod = await import('@/src/stores/authStore');
    return mod.useAuthStore.getState().user?.id ?? null;
  } catch {
    return null;
  }
}

function getAppVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

async function isOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  } catch {
    // Unknown — assume online and let the send attempt decide.
    return true;
  }
}

async function readBuffer(): Promise<AnalyticsPayload[]> {
  try {
    const raw = await AsyncStorage.getItem(BUFFER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AnalyticsPayload[]) : [];
  } catch {
    return [];
  }
}

async function writeBuffer(events: AnalyticsPayload[]): Promise<void> {
  try {
    // Keep only the most recent MAX_BUFFERED — drop oldest on overflow.
    const bounded = events.slice(-MAX_BUFFERED);
    await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(bounded));
  } catch {
    /* best-effort */
  }
}

async function bufferEvent(payload: AnalyticsPayload): Promise<void> {
  const buf = await readBuffer();
  buf.push(payload);
  await writeBuffer(buf);
}

/** Send a batch of events via the edge function. Returns true on success. */
async function sendBatch(events: AnalyticsPayload[]): Promise<boolean> {
  if (events.length === 0) return true;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const options: { body: { events: AnalyticsPayload[] }; headers?: Record<string, string> } = {
      body: { events },
    };
    if (accessToken) options.headers = edgeFunctionInvokeHeaders(accessToken);

    const { error } = await supabase.functions.invoke(FUNCTION_NAME, options);
    return !error;
  } catch {
    return false;
  }
}

/** Try to drain the offline buffer. Safe to call often; no-ops when empty/offline. */
async function flushBuffer(): Promise<void> {
  const buffered = await readBuffer();
  if (buffered.length === 0) return;
  if (!(await isOnline())) return;
  const ok = await sendBatch(buffered);
  if (ok) {
    // Clear only what we sent; new events appended meanwhile are re-read next time.
    const after = await readBuffer();
    const remaining = after.slice(buffered.length);
    await writeBuffer(remaining);
  }
}

function bindConnectivityFlush(): void {
  if (connectivityListenerBound) return;
  connectivityListenerBound = true;
  try {
    NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        void flushBuffer();
      }
    });
  } catch {
    /* listener unavailable in some environments (e.g. tests) */
  }
}

/**
 * Record an analytics event. Fire-and-forget: callers should NOT await this.
 * Never throws. No-ops gracefully when offline (buffers + flushes later).
 */
export function track(event: string, props: Record<string, unknown> = {}): void {
  // Everything async is wrapped so a rejected promise never surfaces to the caller.
  void (async () => {
    try {
      bindConnectivityFlush();
      const payload: AnalyticsPayload = {
        device_id: await getDeviceId(),
        user_id: await getCurrentUserId(),
        event,
        props: props ?? {},
        session_id: SESSION_ID,
        platform: Platform.OS,
        app_version: getAppVersion(),
        ts: new Date().toISOString(),
      };

      if (!(await isOnline())) {
        await bufferEvent(payload);
        return;
      }

      // Online: opportunistically drain anything buffered, then send this one.
      await flushBuffer();
      const ok = await sendBatch([payload]);
      if (!ok) await bufferEvent(payload);
    } catch {
      // Absolutely never throw from analytics.
    }
  })();
}

/** Exposed for tests only. */
export const __analyticsInternals = {
  SESSION_ID,
  DEVICE_ID_KEY,
  BUFFER_KEY,
  MAX_BUFFERED,
  FUNCTION_NAME,
  flushBuffer,
  readBuffer,
  getDeviceId,
};
