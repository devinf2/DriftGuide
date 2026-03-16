import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GuideChat from '@/src/components/GuideChat';
import { useAuthStore } from '@/src/stores/authStore';
import { getSeason, getTimeOfDay } from '@/src/services/ai';
import { fetchFlies } from '@/src/services/flyService';
import type { AIContext } from '@/src/services/ai';

export default function GuideScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();

  const getContext = useCallback(async (): Promise<AIContext> => {
    const now = new Date();
    let userFlies: Awaited<ReturnType<typeof fetchFlies>> = [];
    if (user?.id) {
      try {
        userFlies = await fetchFlies(user.id);
      } catch {
        // non-blocking
      }
    }
    return {
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
  }, [user?.id]);

  return (
    <GuideChat
      getContext={getContext}
      variant="full"
      contentTopPadding={insets.top}
    />
  );
}
