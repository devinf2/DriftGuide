import { Alert } from 'react-native';
import type { Router } from 'expo-router';
import type { Location } from '@/src/types';
import { refreshWaterway } from '@/src/services/waterwayCache';
import type { PlanTripResumePayload } from '@/src/stores/offlineDownloadResumeStore';
import { findOfflineDownloadForPlace } from '@/src/utils/offlineDownloadCoverage';
import { offlineWaterwayLabel } from '@/src/utils/offlineDownloadSummary';

type ResumeFlow = 'plan-trip' | 'fish-now';

export type OfflineTripDownloadPromptParams = {
  lat: number;
  lng: number;
  locationId: string;
  userId: string;
  isConnected: boolean;
  router: Pick<Router, 'push'>;
  resumeFlow: ResumeFlow;
  onProceed: () => void | Promise<void>;
  planTripPayload?: PlanTripResumePayload;
  resumeLocation?: Location;
};

/**
 * Prompt to download or refresh offline map data before creating/starting a trip.
 * Returns true when the caller should stop (alert shown or navigated to region picker).
 */
export async function handleOfflineDataBeforeTrip(
  params: OfflineTripDownloadPromptParams,
): Promise<boolean> {
  const {
    lat,
    lng,
    locationId,
    userId,
    isConnected,
    router,
    resumeFlow,
    onProceed,
    planTripPayload,
    resumeLocation,
  } = params;

  if (!isConnected) return false;

  const existing = await findOfflineDownloadForPlace(lat, lng, locationId);

  if (!existing) {
    Alert.alert(
      'Download map for offline?',
      'This place is not inside a saved offline map region. Download the map now so you can use it without a signal?',
      [
        {
          text: 'Not now',
          style: 'cancel',
          onPress: () => {
            void onProceed();
          },
        },
        {
          text: 'Download',
          onPress: () => {
            const navParams: Record<string, string> = {
              centerLat: String(lat),
              centerLng: String(lng),
              locationId,
              resumeFlow,
            };
            if (resumeFlow === 'plan-trip' && planTripPayload) {
              navParams.planTripPayload = JSON.stringify(planTripPayload);
            }
            if (resumeFlow === 'fish-now' && resumeLocation) {
              navParams.resumeLocation = JSON.stringify(resumeLocation);
            }
            router.push({
              pathname: '/trip/offline-region-picker',
              params: navParams,
            });
          },
        },
      ],
    );
    return true;
  }

  const label = offlineWaterwayLabel(existing);
  Alert.alert(
    'Refresh offline data?',
    `You already have "${label}" saved offline. Refresh conditions and catches now?`,
    [
      {
        text: 'Not now',
        style: 'cancel',
        onPress: () => {
          void onProceed();
        },
      },
      {
        text: 'Refresh',
        onPress: () => {
          void (async () => {
            try {
              await refreshWaterway(existing.locationId, userId);
            } catch (e) {
              console.warn('[offlineTripDownloadPrompt] refresh failed', e);
              Alert.alert(
                'Refresh failed',
                'Could not update offline data. You can try again from Profile → Offline maps.',
              );
            }
            await onProceed();
          })();
        },
      },
    ],
  );
  return true;
}
