import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks for native / RN-only modules the analytics service imports. Vitest runs
// under Node, so these have no real implementation otherwise.
// ---------------------------------------------------------------------------
const memStore = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (memStore.has(k) ? memStore.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => {
      memStore.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      memStore.delete(k);
    }),
  },
}));

const netInfoState = { isConnected: true, isInternetReachable: true };
vi.mock('@react-native-community/netinfo', () => ({
  default: {
    fetch: vi.fn(async () => netInfoState),
    addEventListener: vi.fn(() => () => {}),
  },
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '9.9.9' } },
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

// Spy targets for the supabase client.
const invokeMock = vi.fn(async () => ({ data: { inserted: 1 }, error: null }));
const getSessionMock = vi.fn(async () => ({ data: { session: null } }));
vi.mock('@/src/services/supabase', () => ({
  supabase: {
    auth: { getSession: () => getSessionMock() },
    functions: { invoke: (...args: unknown[]) => invokeMock(...(args as [])) },
  },
  edgeFunctionInvokeHeaders: (token: string) => ({ Authorization: `Bearer ${token}` }),
}));

// authStore is require()'d lazily inside track(); provide a controllable mock.
let mockUserId: string | null = null;
vi.mock('@/src/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ user: mockUserId ? { id: mockUserId } : null }) },
}));

// Import AFTER mocks are registered.
import { track, AnalyticsEvents, __analyticsInternals } from '@/src/services/analytics';

/** track() is fire-and-forget; give its internal microtasks a chance to settle. */
async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  memStore.clear();
  invokeMock.mockClear();
  getSessionMock.mockClear();
  netInfoState.isConnected = true;
  netInfoState.isInternetReachable = true;
  mockUserId = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('track', () => {
  it('never throws even when invoked synchronously', () => {
    expect(() => track(AnalyticsEvents.APP_OPEN)).not.toThrow();
    expect(() => track('arbitrary_event', { a: 1 })).not.toThrow();
  });

  it('sends an event with the expected context fields when online', async () => {
    mockUserId = '11111111-1111-1111-1111-111111111111';
    track(AnalyticsEvents.SPOT_VIEW, { spot_id: 'loc-1' });
    await flushAsync();

    expect(invokeMock).toHaveBeenCalled();
    const [fnName, options] = invokeMock.mock.calls.at(-1) as unknown as [string, { body: { events: any[] } }];
    expect(fnName).toBe(__analyticsInternals.FUNCTION_NAME);

    const sent = options.body.events.find((e) => e.event === AnalyticsEvents.SPOT_VIEW);
    expect(sent).toBeTruthy();
    expect(sent.props).toEqual({ spot_id: 'loc-1' });
    expect(sent.user_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(sent.platform).toBe('ios');
    expect(sent.app_version).toBe('9.9.9');
    expect(typeof sent.device_id).toBe('string');
    expect(sent.device_id.length).toBeGreaterThan(0);
    expect(sent.session_id).toBe(__analyticsInternals.SESSION_ID);
    expect(typeof sent.ts).toBe('string');
  });

  it('does not throw and buffers when the backend invoke rejects', async () => {
    invokeMock.mockRejectedValueOnce(new Error('network down'));
    expect(() => track(AnalyticsEvents.SIGNUP)).not.toThrow();
    await flushAsync();

    const buffered = await __analyticsInternals.readBuffer();
    expect(buffered.some((e) => e.event === AnalyticsEvents.SIGNUP)).toBe(true);
  });

  it('buffers events while offline and flushes them once online', async () => {
    netInfoState.isConnected = false;
    netInfoState.isInternetReachable = false;
    track(AnalyticsEvents.START_TRIP, { trip_id: 't1' });
    await flushAsync();

    expect(invokeMock).not.toHaveBeenCalled();
    let buffered = await __analyticsInternals.readBuffer();
    expect(buffered.some((e) => e.event === AnalyticsEvents.START_TRIP)).toBe(true);

    // Reconnect and emit another event — the buffer should drain.
    netInfoState.isConnected = true;
    netInfoState.isInternetReachable = true;
    track(AnalyticsEvents.FIRST_CATCH);
    await flushAsync();

    expect(invokeMock).toHaveBeenCalled();
    buffered = await __analyticsInternals.readBuffer();
    expect(buffered.length).toBe(0);
  });

  it('attaches a stable anonymous device id across calls', async () => {
    track(AnalyticsEvents.APP_OPEN);
    await flushAsync();
    const firstCall = invokeMock.mock.calls.at(-1) as unknown as [string, { body: { events: any[] } }];
    const id1 = firstCall[1].body.events.at(-1).device_id;
    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(0);

    track(AnalyticsEvents.GUEST_BROWSE);
    await flushAsync();
    const secondCall = invokeMock.mock.calls.at(-1) as unknown as [string, { body: { events: any[] } }];
    const id2 = secondCall[1].body.events.at(-1).device_id;
    expect(id2).toBe(id1);
  });
});
