import { useCallback } from 'react';
import { useRouter } from 'expo-router';

import { useAuthStore } from '@/src/stores/authStore';

/** Read-only: is the current user a guest (no Supabase session)? */
export function useIsGuest(): boolean {
  return useAuthStore((s) => s.session == null);
}

/**
 * Gate writes, not reads (WS-B).
 *
 * Returns a `requireAuth(message?)` callback for account-bound actions (start/save a trip, friends,
 * posting). When the user already has a session it returns `true` and the caller proceeds. When the
 * user is a guest it stashes a contextual message (e.g. "Sign in to save your trip"), opens the
 * `/auth` sheet, and returns `false` so the caller bails out of the write.
 *
 * The auth screen is presented as a dismissible sheet (see `app/auth/_layout.tsx`), so cancelling
 * returns the guest to whatever they were browsing.
 */
export function useRequireAuth(): (message?: string) => boolean {
  const router = useRouter();

  return useCallback(
    (message?: string) => {
      const { session, setAuthPromptMessage } = useAuthStore.getState();
      if (session) return true;
      setAuthPromptMessage(message ?? null);
      router.push('/auth');
      return false;
    },
    [router],
  );
}
