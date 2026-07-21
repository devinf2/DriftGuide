import { createClient } from '@supabase/supabase-js';

import { createDriftGuideSupabaseAuthStorage } from '@/src/services/supabaseAuthStorage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Edge Functions expect the project anon key in `apikey` plus the user JWT in `Authorization`.
 * On React Native, passing only `Authorization` can leave `apikey` unset on the wire and yield 401.
 */
export function edgeFunctionInvokeHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (supabaseAnonKey) headers.apikey = supabaseAnonKey;
  return headers;
}

/** Cap every backend request; "one bar" of service must not stall a full load forever. */
const NETWORK_TIMEOUT_MS = 12_000;

/**
 * Offline-first fetch: aborts after {@link NETWORK_TIMEOUT_MS} instead of hanging on a stalled
 * socket (weak/"tiny bit of" service). A timed-out request rejects like any network failure, so
 * GoTrue reschedules token refresh and PostgREST callers fall back to on-device caches — the app
 * degrades to offline rather than freezing on a load it can't finish. Honors a caller's own signal.
 */
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: createDriftGuideSupabaseAuthStorage(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchWithTimeout },
});
