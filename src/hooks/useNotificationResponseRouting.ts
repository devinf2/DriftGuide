/**
 * WS-G — Notification tap routing (NATIVE; depends on expo-notifications).
 *
 * Self-contained hook the integrator mounts ONCE inside the app tree (e.g. in
 * app/_layout.tsx alongside the existing deep-link handling). When the user taps
 * a notification, this routes to the relevant screen based on the notification
 * `data` payload. The pure payload->route mapping lives in
 * src/utils/notificationRouting.ts (routeForNotificationData) and mirrors the
 * UUID validation of the existing driftguide://trip/:id deep-link parser.
 */
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';

import { routeForNotificationData } from '@/src/utils/notificationRouting';

/**
 * Mount once near the app root. Wires the expo-notifications response listener
 * (taps) and also handles the cold-start case where the app was opened from a
 * notification, matching how _layout.tsx handles cold-start deep links.
 */
export function useNotificationResponseRouting(): void {
  const router = useRouter();

  useEffect(() => {
    const handle = (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      const href = routeForNotificationData(data);
      if (href) router.push(href as never);
    };

    // Tap while app is running / backgrounded.
    const sub = Notifications.addNotificationResponseReceivedListener(handle);

    // Cold start: app opened by tapping a notification.
    Notifications.getLastNotificationResponseAsync()
      .then(handle)
      .catch(() => {});

    return () => sub.remove();
  }, [router]);
}
