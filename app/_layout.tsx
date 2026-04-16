import 'react-native-get-random-values';
import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { applyOAuthReturnUrl } from '@/src/auth/googleOAuth';
import { GlobalOfflineBanner } from '@/src/components/GlobalOfflineBanner';
import { SyncOnConnectivity } from '@/src/components/SyncOnConnectivity';
import { supabase } from '@/src/services/supabase';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationFavoritesStore } from '@/src/stores/locationFavoritesStore';
import { ThemeProvider, useAppTheme } from '@/src/theme/ThemeProvider';
import { needsProfileOnboarding } from '@/src/utils/profileOnboarding';

export { ErrorBoundary } from 'expo-router';

/** Set by `driftguide://trip/:id` (or https trip path); cleared when navigation runs. */
let pendingTripIdFromShareLink: string | null = null;

function parseTripDeepLink(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  const schemeMatch = trimmed.match(/^driftguide:\/\/trip\/([^/?#]+)/i);
  if (schemeMatch?.[1]) {
    const id = decodeURIComponent(schemeMatch[1]);
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ) {
      return id;
    }
    return null;
  }
  try {
    const u = new URL(trimmed);
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('trip');
    if (idx >= 0 && parts[idx + 1]) {
      const id = parts[idx + 1];
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      ) {
        return id;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

WebBrowser.maybeCompleteAuthSession();

/** Production builds: `__DEV__` is false → no `require` → dev overlay never loads or ships. */
const OfflineSimOverlay: ComponentType | undefined = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional dev-only dynamic load
    require('@/src/dev/OfflineSimOverlay').OfflineSimOverlay
  : undefined;

const styles = StyleSheet.create({
  authGateRoot: { flex: 1 },
  authGateStackShell: { flex: 1 },
  devOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100000,
    elevation: 100000,
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const session = useAuthStore((s) => s.session);
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isProfileLoading = useAuthStore((s) => s.isProfileLoading);
  const setSession = useAuthStore((s) => s.setSession);
  const fetchProfile = useAuthStore((s) => s.fetchProfile);
  const signOut = useAuthStore((s) => s.signOut);
  const segments = useSegments();
  const router = useRouter();
  const closedAccountHandledRef = useRef(false);

  const flushPendingTripDeepLink = useCallback(() => {
    const tid = pendingTripIdFromShareLink;
    if (!tid) return;
    const { session, isLoading, isProfileLoading, profile } = useAuthStore.getState();
    if (!session || isLoading || isProfileLoading) return;
    if (needsProfileOnboarding(profile)) return;
    const top = segments[0];
    if (top === 'auth' || top === 'onboarding') return;
    pendingTripIdFromShareLink = null;
    router.push(`/trip/${tid}/summary`);
  }, [router, segments]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile();
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile();
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user?.id) void useLocationFavoritesStore.getState().refresh(user.id);
    else useLocationFavoritesStore.getState().reset();
  }, [user?.id]);

  useEffect(() => {
    const handleIncomingUrl = (url: string | null) => {
      if (!url) return;
      const tripId = parseTripDeepLink(url);
      if (tripId) {
        pendingTripIdFromShareLink = tripId;
        queueMicrotask(() => {
          flushPendingTripDeepLink();
        });
        return;
      }
      void (async () => {
        try {
          await applyOAuthReturnUrl(url);
        } catch {
          /* unrelated or malformed deep link */
        }
      })();
    };

    const sub = Linking.addEventListener('url', ({ url }) => {
      handleIncomingUrl(url);
    });
    void Linking.getInitialURL().then(handleIncomingUrl);
    return () => sub.remove();
  }, [flushPendingTripDeepLink]);

  useEffect(() => {
    if (session && profile?.account_deleted_at) {
      if (closedAccountHandledRef.current) return;
      closedAccountHandledRef.current = true;
      void (async () => {
        await signOut();
        Alert.alert(
          'Account closed',
          'This account was deleted. Sign in with a different account to use DriftGuide.',
        );
      })();
      return;
    }
    if (!session) closedAccountHandledRef.current = false;

    if (isLoading || (session && isProfileLoading)) return;

    const inAuth = segments[0] === 'auth';
    const inOnboarding = segments[0] === 'onboarding';

    if (!session) {
      if (!inAuth) router.replace('/auth');
      return;
    }

    if (inAuth) {
      router.replace('/');
      return;
    }

    const needOnboarding = needsProfileOnboarding(profile);
    if (needOnboarding && !inOnboarding) {
      router.replace('/onboarding');
      return;
    }
    if (!needOnboarding && inOnboarding) {
      router.replace('/');
    }

    flushPendingTripDeepLink();
  }, [
    session,
    profile,
    segments,
    isLoading,
    isProfileLoading,
    router,
    signOut,
    flushPendingTripDeepLink,
  ]);

  return (
    <View style={styles.authGateRoot}>
      {session ? <SyncOnConnectivity /> : null}
      {session ? <GlobalOfflineBanner /> : null}
      <View style={styles.authGateStackShell}>{children}</View>
      {OfflineSimOverlay ? (
        <View pointerEvents="box-none" style={styles.devOverlay}>
          <OfflineSimOverlay />
        </View>
      ) : null}
    </View>
  );
}

function ThemedNavigation() {
  const { colors, resolvedScheme } = useAppTheme();

  return (
    <>
      <AuthGate>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: colors.textInverse,
            headerTitleStyle: { color: colors.textInverse, fontWeight: '600' },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen
            name="trip/new"
            options={{
              title: 'Plan a Trip',
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="trip/fish-now"
            options={{
              title: 'Fish now',
              headerShown: false,
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="trip/import-past"
            options={{
              title: 'Import past trips',
              headerShown: false,
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="spot/[id]"
            options={{
              presentation: 'modal',
              headerShown: false,
            }}
          />
          <Stack.Screen
            name="spot/edit-pin"
            options={{
              title: 'Edit pin',
              presentation: 'modal',
              headerBackTitle: 'Back',
            }}
          />
          <Stack.Screen
            name="trip/add-location"
            options={{ title: 'Add Location', presentation: 'modal' }}
          />
          <Stack.Screen
            name="trip/pick-location-map"
            options={{ headerShown: false, animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="trip/add-access-point"
            options={{ title: 'Add access point', presentation: 'modal' }}
          />
          <Stack.Screen
            name="trip/download-waterway"
            options={{ title: 'Download for offline', headerBackTitle: 'Back', headerLargeTitle: false }}
          />
          <Stack.Screen
            name="trip/offline-region-picker"
            options={{ title: 'Choose region', headerBackTitle: 'Back' }}
          />
          <Stack.Screen
            name="trip/[id]"
            options={{ headerShown: false, animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="session/link-trip"
            options={{ headerShown: false, animation: 'slide_from_right' }}
          />
          <Stack.Screen name="photos" options={{ headerShown: false }} />
          <Stack.Screen
            name="fly-box"
            options={{
              headerShown: false,
              animation: 'slide_from_right',
            }}
          />
        </Stack>
      </AuthGate>
      <StatusBar style={resolvedScheme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  const authLoading = useAuthStore((s) => s.isLoading);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded && !authLoading) {
      void SplashScreen.hideAsync();
    }
  }, [loaded, authLoading]);

  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider>
          <ThemedNavigation />
        </ThemeProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
