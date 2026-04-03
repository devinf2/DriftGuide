import 'react-native-get-random-values';
import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { SyncOnConnectivity } from '@/src/components/SyncOnConnectivity';
import { supabase } from '@/src/services/supabase';
import { useAuthStore } from '@/src/stores/authStore';
import { ThemeProvider, useAppTheme } from '@/src/theme/ThemeProvider';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, isLoading, setSession, fetchProfile } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

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
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!session && !inAuthGroup) {
      router.replace('/auth');
    } else if (session && inAuthGroup) {
      router.replace('/');
    }
  }, [session, segments, isLoading]);

  return (
    <>
      {session ? <SyncOnConnectivity /> : null}
      {children}
    </>
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
          <Stack.Screen name="photos" options={{ headerShown: false }} />
          <Stack.Screen
            name="fly-box"
            options={{
              title: 'Fly Box',
              headerBackTitle: 'Back',
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

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

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
