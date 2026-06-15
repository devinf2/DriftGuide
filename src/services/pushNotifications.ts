/**
 * WS-G — Push notification infrastructure (NATIVE module; depends on
 * expo-notifications). Keep all expo-notifications usage behind this file so the
 * pure decision modules (streaksMilestones, conditionsThresholds, tripReminders,
 * activityRecipients) stay unit-testable without the native module.
 *
 * Responsibilities:
 *  - Configure the foreground notification handler + Android channel.
 *  - Request OS permission WITH rationale, post-activation only (after a trip is
 *    completed, or from the settings toggle) — never at first launch.
 *  - Register the Expo push token and upsert it into `device_tokens` (mig 119).
 *  - Schedule / cancel local notifications from the pure ReminderDecision shape.
 *  - A `track`-style fire-and-forget API so callers never need to await.
 *
 * The scheduled remote pushes (conditions / friend activity) are sent by the
 * edge functions; this file only handles client-side token registration, local
 * notifications, and the foreground handler.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

import { supabase } from '@/src/services/supabase';
import type { ReminderDecision } from '@/src/utils/tripReminders';

const ANDROID_CHANNEL_ID = 'default';

/** AsyncStorage key for the user's notifications opt-in preference (settings toggle). */
export const NOTIFICATIONS_OPT_IN_KEY = 'driftguide.notifications.optIn';

/** Foreground presentation: show banners + play sound while the app is open. */
let handlerConfigured = false;
export function configureNotificationHandler(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Android requires an explicit channel for notifications to display. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'DriftGuide',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Request notification permission. Call this POST-ACTIVATION only — e.g. after a
 * trip completes or from the settings toggle — so the OS prompt lands when the
 * value is obvious, not at first launch. Returns whether permission is granted.
 * Caller is responsible for showing in-app rationale copy before invoking.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) return false; // simulators can't get a push token
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  return status === 'granted';
}

function resolveProjectId(): string | undefined {
  const fromExpoConfig = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof fromExpoConfig === 'string') return fromExpoConfig;
  // easConfig is present at runtime on some SDKs but not always typed.
  const easConfig = (Constants as { easConfig?: { projectId?: string } }).easConfig;
  return easConfig?.projectId;
}

/**
 * Register for an Expo push token and upsert it into `device_tokens` for the
 * signed-in user. No-ops (returns null) without permission, on a simulator, or
 * when not signed in. Safe to call repeatedly — upserts on the unique token.
 */
export async function registerPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const granted = await requestNotificationPermission();
  if (!granted) return null;

  await ensureAndroidChannel();

  let expoPushToken: string;
  try {
    const projectId = resolveProjectId();
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    expoPushToken = tokenResult.data;
  } catch (err) {
    console.warn('[pushNotifications] getExpoPushTokenAsync failed', err);
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;

  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      {
        user_id: user.id,
        expo_push_token: expoPushToken,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' },
    );
  if (error) {
    console.warn('[pushNotifications] device_tokens upsert failed', error.message);
    return null;
  }
  return expoPushToken;
}

/** Remove this device's token (settings opt-out). Best-effort. */
export async function unregisterPushToken(): Promise<void> {
  try {
    const projectId = resolveProjectId();
    const { data } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!data) return;
    await supabase.from('device_tokens').delete().eq('expo_push_token', data);
  } catch (err) {
    console.warn('[pushNotifications] unregister failed', err);
  }
}

/**
 * Fire-and-forget token registration. `track`-style API: callers (e.g. the
 * trip-completed flow) can invoke without awaiting; errors are swallowed.
 */
export function trackPushRegistration(): void {
  void registerPushToken().catch((err) =>
    console.warn('[pushNotifications] trackPushRegistration', err),
  );
}

/**
 * Schedule a single local notification from a pure ReminderDecision. Uses the
 * decision `key` as the identifier so re-scheduling can cancel/replace it.
 * Returns the scheduled identifier, or null if it was in the past / failed.
 */
export async function scheduleLocalReminder(
  decision: ReminderDecision,
): Promise<string | null> {
  const secondsFromNow = Math.round((decision.fireAtMs - Date.now()) / 1000);
  if (secondsFromNow <= 0) return null;
  try {
    // Cancel any prior copy with the same key so we never double-schedule.
    await Notifications.cancelScheduledNotificationAsync(decision.key).catch(() => {});
    const id = await Notifications.scheduleNotificationAsync({
      identifier: decision.key,
      content: { title: decision.title, body: decision.body, data: decision.data },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsFromNow,
      },
    });
    return id;
  } catch (err) {
    console.warn('[pushNotifications] scheduleLocalReminder failed', err);
    return null;
  }
}

/** Schedule many reminders; fire-and-forget friendly. */
export async function scheduleLocalReminders(decisions: ReminderDecision[]): Promise<void> {
  for (const d of decisions) {
    await scheduleLocalReminder(d);
  }
}

/** Present an immediate local notification (e.g. streak-at-risk / new milestone). */
export async function presentLocalNotification(
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data },
      trigger: null, // fire now
    });
  } catch (err) {
    console.warn('[pushNotifications] presentLocalNotification failed', err);
  }
}
