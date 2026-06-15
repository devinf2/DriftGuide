import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import {
  isEmailIdentifier,
  isValidUsernameForLogin,
  normalizeUsernameForLogin,
} from '@/src/auth/authIdentifiers';
import { signInWithAppleNative } from '@/src/auth/appleAuth';
import { getAuthCallbackRedirectUri, signInWithGoogleOAuth } from '@/src/auth/googleOAuth';
import { Profile, type TripPhotoVisibility } from '@/src/types';
import { edgeFunctionInvokeHeaders, supabase } from '@/src/services/supabase';
import { clearTripPhotoOfflineCache } from '@/src/services/tripPhotoOfflineCache';
import { useThemeStore } from '@/src/stores/themeStore';
import { useTripStore } from '@/src/stores/tripStore';
import { isUsCountry } from '@/src/constants/countries';
import { validateProfileOnboarding } from '@/src/utils/profileOnboarding';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email/username or password.';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  /** True while fetching profile for the current session (avoid onboarding flash). */
  isProfileLoading: boolean;
  /** After opening a password-reset deep link; cleared when the user sets a new password or signs out. */
  passwordRecoveryPending: boolean;
  /**
   * Contextual prompt shown on the auth screen when a guest taps an account-bound action
   * (e.g. "Sign in to save your trip"). Null for the cold-start / generic sign-in case.
   */
  authPromptMessage: string | null;
  setAuthPromptMessage: (message: string | null) => void;
  setPasswordRecoveryPending: (pending: boolean) => void;
  setSession: (session: Session | null) => void;
  /** If `getSession()` throws during cold start, clear splash without guessing session. */
  clearAuthBootstrap: () => void;
  setProfile: (profile: Profile | null) => void;
  fetchProfile: () => Promise<void>;
  updateProfileNames: (firstName: string, lastName: string) => Promise<{ error: string | null }>;
  updateUsername: (username: string) => Promise<{ error: string | null }>;
  updateHomeState: (homeState: string | null) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: string | null }>;
  /** Email or @username plus password (username resolved server-side). */
  signIn: (identifier: string, password: string) => Promise<{ error: string | null }>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithApple: () => Promise<{ error: string | null }>;
  completeProfileOnboarding: (input: {
    firstName: string;
    lastName: string;
    /** Country name or ISO 3166-1 alpha-2 code (required). */
    homeCountry: string;
    /** Region/state within the country (optional). For US this is the state. */
    homeRegion?: string;
    darkModeEnabled: boolean;
    defaultTripPhotoVisibility: TripPhotoVisibility;
  }) => Promise<{ error: string | null }>;
  updateDefaultTripPhotoVisibility: (v: TripPhotoVisibility) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** Soft-delete cloud data for the current user, clear local trip state, then sign out. */
  softDeleteAccount: () => Promise<{ error: string | null }>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      user: null,
      profile: null,
      isLoading: true,
      isProfileLoading: false,
      passwordRecoveryPending: false,
      authPromptMessage: null,

      setAuthPromptMessage: (message) => set({ authPromptMessage: message }),

      setPasswordRecoveryPending: (pending) => set({ passwordRecoveryPending: pending }),

      setSession: (session) => {
        set({
          session,
          user: session?.user ?? null,
          isLoading: false,
          isProfileLoading: Boolean(session),
          // A real session arrived (any sign-in path) → drop any pending "sign in to…" prompt.
          ...(session ? { authPromptMessage: null } : { profile: null }),
        });
      },

      clearAuthBootstrap: () => set({ isLoading: false }),

      setProfile: (profile) => set({ profile }),

      fetchProfile: async () => {
        const user = get().user;
        if (!user) {
          set({ isProfileLoading: false });
          return;
        }

        set({ isProfileLoading: true });
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (!error && data) {
          set({ profile: data as Profile });
        }
        set({ isProfileLoading: false });
      },

      updateProfileNames: async (firstName, lastName) => {
        const user = get().user;
        if (!user) return { error: 'Not signed in' };
        const fn = firstName.trim();
        const ln = lastName.trim();
        const combined = [fn, ln].filter(Boolean).join(' ');
        const display_name =
          combined || get().profile?.display_name?.trim() || 'Angler';
        const { error } = await supabase
          .from('profiles')
          .update({
            first_name: fn || null,
            last_name: ln || null,
            display_name,
          })
          .eq('id', user.id);
        if (error) return { error: error.message };
        await get().fetchProfile();
        return { error: null };
      },

      updateUsername: async (raw) => {
        const user = get().user;
        if (!user) return { error: 'Not signed in' };
        const trimmed = raw.trim();
        const { error } = await supabase.rpc('set_my_username', {
          p_username: trimmed.length ? trimmed : null,
        });
        if (error) return { error: error.message };
        await get().fetchProfile();
        return { error: null };
      },

      updateHomeState: async (homeState) => {
        const user = get().user;
        if (!user) return { error: 'Not signed in' };
        const v = homeState?.trim() || null;
        const { error } = await supabase.from('profiles').update({ home_state: v }).eq('id', user.id);
        if (error) return { error: error.message };
        await get().fetchProfile();
        return { error: null };
      },

      signUp: async (email, password, displayName) => {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } },
        });

        if (error) return { error: error.message };

        if (data.session) {
          set({ session: data.session, user: data.user });
          await get().fetchProfile();
        }

        return { error: null };
      },

      signIn: async (identifier, password) => {
        const trimmed = identifier.trim();
        if (!trimmed) return { error: INVALID_CREDENTIALS_MESSAGE };

        if (isEmailIdentifier(trimmed)) {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: trimmed,
            password,
          });
          if (error) return { error: INVALID_CREDENTIALS_MESSAGE };
          set({ session: data.session, user: data.user });
          await get().fetchProfile();
          return { error: null };
        }

        const username = normalizeUsernameForLogin(trimmed);
        if (!isValidUsernameForLogin(username)) {
          return {
            error:
              'Usernames are 3–20 characters: lowercase letters, numbers, and underscores only.',
          };
        }

        const { data, error: fnError } = await supabase.functions.invoke<{
          access_token?: string;
          refresh_token?: string;
          error?: string;
        }>('login-with-identifier', { body: { username, password } });

        if (fnError) return { error: INVALID_CREDENTIALS_MESSAGE };
        if (data && typeof data === 'object' && 'error' in data && data.error) {
          return { error: INVALID_CREDENTIALS_MESSAGE };
        }
        const access_token = data?.access_token;
        const refresh_token = data?.refresh_token;
        if (!access_token || !refresh_token) return { error: INVALID_CREDENTIALS_MESSAGE };

        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (sessionError || !sessionData.session) return { error: INVALID_CREDENTIALS_MESSAGE };

        set({ session: sessionData.session, user: sessionData.session.user, isLoading: false });
        await get().fetchProfile();
        return { error: null };
      },

      requestPasswordReset: async (email) => {
        const trimmed = email.trim();
        if (!trimmed) return { error: 'Please enter your email address.' };
        const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
          redirectTo: getAuthCallbackRedirectUri(),
        });
        if (error) return { error: error.message };
        return { error: null };
      },

      signInWithGoogle: async () => {
        const result = await signInWithGoogleOAuth();
        if (result.cancelled) return { error: null };
        if (result.error) return { error: result.error };

        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          set({ session, user: session.user, isLoading: false });
        }
        await get().fetchProfile();

        return { error: null };
      },

      signInWithApple: async () => {
        const result = await signInWithAppleNative();
        if (result.cancelled) return { error: null };
        if (result.error) return { error: result.error };

        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          set({ session, user: session.user, isLoading: false });
        }
        await get().fetchProfile();

        return { error: null };
      },

      completeProfileOnboarding: async ({
        firstName,
        lastName,
        homeCountry,
        homeRegion,
        darkModeEnabled,
        defaultTripPhotoVisibility,
      }) => {
        const user = get().user;
        if (!user) return { error: 'Not signed in' };

        const fn = firstName.trim();
        const ln = lastName.trim();
        const hc = homeCountry.trim();
        const hr = homeRegion?.trim() ?? '';
        const validation = validateProfileOnboarding({
          firstName,
          lastName,
          homeCountry,
          homeRegion,
        });
        if (validation.error) return { error: validation.error };

        const combined = [fn, ln].filter(Boolean).join(' ');
        const display_name = combined || get().profile?.display_name?.trim() || 'Angler';

        // Backward-compat: keep `home_state` populated for US so the offline snapshot
        // bbox filter still works; clear it for non-US so a stale US state can't apply.
        const homeStateForCompat = isUsCountry(hc) ? hr || null : null;

        const { error } = await supabase
          .from('profiles')
          .update({
            first_name: fn,
            last_name: ln,
            home_country: hc,
            home_region: hr || null,
            home_state: homeStateForCompat,
            display_name,
            onboarding_completed_at: new Date().toISOString(),
            default_trip_photo_visibility: defaultTripPhotoVisibility,
          })
          .eq('id', user.id);

        if (error) return { error: error.message };

        useThemeStore.getState().setDarkModeEnabled(darkModeEnabled);
        await get().fetchProfile();

        return { error: null };
      },

      updateDefaultTripPhotoVisibility: async (v) => {
        const user = get().user;
        if (!user) return { error: 'Not signed in' };
        const { error } = await supabase
          .from('profiles')
          .update({ default_trip_photo_visibility: v })
          .eq('id', user.id);
        if (error) return { error: error.message };
        await get().fetchProfile();
        return { error: null };
      },

      signOut: async () => {
        await supabase.auth.signOut();
        set({
          session: null,
          user: null,
          profile: null,
          isProfileLoading: false,
          passwordRecoveryPending: false,
        });
      },

      softDeleteAccount: async () => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) return { error: 'Not signed in' };

        const { error: rpcError } = await supabase.rpc('soft_delete_my_account');
        if (rpcError) return { error: rpcError.message };

        const { data: fnData, error: fnError } = await supabase.functions.invoke(
          'delete-closed-auth-user',
          { headers: edgeFunctionInvokeHeaders(session.access_token) },
        );

        if (fnError) {
          return {
            error: `Your data was removed, but releasing your email for a new account failed (${fnError.message}). Try again or contact support.`,
          };
        }
        if (fnData && typeof fnData === 'object' && 'error' in fnData && fnData.error) {
          return { error: String(fnData.error) };
        }

        try {
          await clearTripPhotoOfflineCache();
        } catch {
          /* offline cache is best-effort */
        }

        await useTripStore.getState().clearAllLocalTripData();

        await supabase.auth.signOut();
        set({
          session: null,
          user: null,
          profile: null,
          isProfileLoading: false,
          passwordRecoveryPending: false,
        });
        await AsyncStorage.removeItem('auth-storage');

        return { error: null };
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ profile: state.profile }),
    }
  )
);
