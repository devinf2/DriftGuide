import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User } from '@supabase/supabase-js';
import { signInWithAppleNative } from '@/src/auth/appleAuth';
import { signInWithGoogleOAuth } from '@/src/auth/googleOAuth';
import { Profile, type TripPhotoVisibility } from '@/src/types';
import { edgeFunctionInvokeHeaders, supabase } from '@/src/services/supabase';
import { clearTripPhotoOfflineCache } from '@/src/services/tripPhotoOfflineCache';
import { useThemeStore } from '@/src/stores/themeStore';
import { useTripStore } from '@/src/stores/tripStore';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  /** True while fetching profile for the current session (avoid onboarding flash). */
  isProfileLoading: boolean;
  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  fetchProfile: () => Promise<void>;
  updateProfileNames: (firstName: string, lastName: string) => Promise<{ error: string | null }>;
  updateUsername: (username: string) => Promise<{ error: string | null }>;
  updateHomeState: (homeState: string | null) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithApple: () => Promise<{ error: string | null }>;
  completeProfileOnboarding: (input: {
    firstName: string;
    lastName: string;
    homeState: string;
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

      setSession: (session) => {
        set({
          session,
          user: session?.user ?? null,
          isLoading: false,
          isProfileLoading: Boolean(session),
          ...(session ? {} : { profile: null }),
        });
      },

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

      signIn: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) return { error: error.message };

        set({ session: data.session, user: data.user });
        await get().fetchProfile();

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
        homeState,
        darkModeEnabled,
        defaultTripPhotoVisibility,
      }) => {
        const user = get().user;
        if (!user) return { error: 'Not signed in' };

        const fn = firstName.trim();
        const ln = lastName.trim();
        const hs = homeState.trim();
        if (!fn || !ln) return { error: 'Please enter your first and last name.' };
        if (!hs) return { error: 'Please choose your home state.' };

        const combined = [fn, ln].filter(Boolean).join(' ');
        const display_name = combined || get().profile?.display_name?.trim() || 'Angler';

        const { error } = await supabase
          .from('profiles')
          .update({
            first_name: fn,
            last_name: ln,
            home_state: hs,
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
        set({ session: null, user: null, profile: null, isProfileLoading: false });
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
        set({ session: null, user: null, profile: null, isProfileLoading: false });
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
