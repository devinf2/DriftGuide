import GuideChat from '@/src/components/GuideChat';
import type { AIContext } from '@/src/services/ai';
import { getSeason, getTimeOfDay } from '@/src/services/ai';
import { fetchFlies } from '@/src/services/flyService';
import { enrichContextWithLocationCatchData } from '@/src/services/guideCatchContext';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationStore } from '@/src/stores/locationStore';
import * as ExpoLocation from 'expo-location';
import { useCallback, useEffect, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function GuideScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { locations, fetchLocations } = useLocationStore();
  const userProxRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (locations.length === 0) fetchLocations();
  }, [locations.length, fetchLocations]);

  useEffect(() => {
    (async () => {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      try {
        const loc = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        userProxRef.current = [loc.coords.longitude, loc.coords.latitude];
      } catch {
        userProxRef.current = null;
      }
    })();
  }, []);

  const getContext = useCallback(
    async ({ question }: { question: string }): Promise<AIContext> => {
      const now = new Date();
      let userFlies: Awaited<ReturnType<typeof fetchFlies>> = [];
      if (user?.id) {
        try {
          userFlies = await fetchFlies(user.id);
        } catch {
          // non-blocking
        }
      }
      const base: AIContext = {
        location: null,
        fishingType: 'fly',
        weather: null,
        waterFlow: null,
        currentFly: null,
        fishCount: 0,
        recentEvents: [],
        timeOfDay: getTimeOfDay(now),
        season: getSeason(now),
        userFlies: userFlies.length > 0 ? userFlies : null,
      };
      return enrichContextWithLocationCatchData(base, {
        question,
        locations,
        userId: user?.id ?? null,
        userLat: userProxRef.current?.[1] ?? null,
        userLng: userProxRef.current?.[0] ?? null,
        referenceDate: now,
      });
    },
    [user?.id, locations],
  );

  return (
    <GuideChat
      getContext={getContext}
      variant="full"
      contentTopPadding={insets.top}
    />
  );
}
