import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useTripStore } from '@/src/stores/tripStore';
import { fetchTripById } from '@/src/services/sync';
import {
  attachTripToSession,
  fetchSessionInviteById,
  resolveInviterTemplateTripForJoin,
} from '@/src/services/sharedSessionService';
import {
  canJoinSessionWithCurrentTrip,
  hasActiveTripBlockingSessionJoin,
} from '@/src/utils/sessionInviteMergeTrips';
import { formatTripDate } from '@/src/utils/formatters';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import type { FishingType } from '@/src/types';

export default function SessionLinkTripScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const effectiveTop = useEffectiveSafeTopInset();
  const { user } = useAuthStore();
  const activeTrip = useTripStore((s) => s.activeTrip);
  const startTrip = useTripStore((s) => s.startTrip);
  const patchActiveTrip = useTripStore((s) => s.patchActiveTrip);
  const clearActiveTrip = useTripStore((s) => s.clearActiveTrip);
  const { isConnected } = useNetworkStatus();
  const { sessionId, inviteId } = useLocalSearchParams<{ sessionId: string; inviteId?: string }>();

  const [linkingCurrent, setLinkingCurrent] = useState(false);
  const [autoCreating, setAutoCreating] = useState(false);
  const [autoFailed, setAutoFailed] = useState(false);
  const autoJoinInFlightRef = useRef(false);

  const currentForLiveJoin = useMemo(() => {
    if (!user?.id || !activeTrip || activeTrip.user_id !== user.id) return null;
    return canJoinSessionWithCurrentTrip(activeTrip) ? activeTrip : null;
  }, [user?.id, activeTrip]);

  const blockingOtherSession = useMemo(
    () => hasActiveTripBlockingSessionJoin(activeTrip, sessionId),
    [activeTrip, sessionId],
  );

  /** Drop ghost “active group trip” from persisted store when the server row has ended or left the group. */
  useEffect(() => {
    if (!isConnected || !user?.id || !activeTrip?.id || activeTrip.user_id !== user.id) return;
    let cancelled = false;
    void fetchTripById(activeTrip.id).then((fresh) => {
      if (cancelled) return;
      if (!fresh) return;
      if (fresh.user_id !== user.id) {
        clearActiveTrip();
        return;
      }
      if (fresh.deleted_at || fresh.status !== 'active') {
        clearActiveTrip();
        return;
      }
      const sid = fresh.shared_session_id ?? null;
      const cur = activeTrip.shared_session_id ?? null;
      if (sid !== cur) patchActiveTrip({ shared_session_id: sid });
    });
    return () => {
      cancelled = true;
    };
  }, [isConnected, user?.id, activeTrip?.id, activeTrip?.user_id, activeTrip?.shared_session_id, clearActiveTrip, patchActiveTrip]);

  /** Already linked to this session — go to the live trip (don’t auto-create another). */
  useEffect(() => {
    if (!sessionId?.trim() || !user?.id || !activeTrip?.id || activeTrip.user_id !== user.id) return;
    if (activeTrip.status !== 'active' || activeTrip.deleted_at) return;
    if ((activeTrip.shared_session_id ?? '').trim() !== sessionId.trim()) return;
    router.replace(`/trip/${activeTrip.id}`);
  }, [
    sessionId,
    user?.id,
    activeTrip?.id,
    activeTrip?.user_id,
    activeTrip?.status,
    activeTrip?.deleted_at,
    activeTrip?.shared_session_id,
    router,
  ]);

  const handleJoinWithCurrentOuting = async () => {
    if (!sessionId || !currentForLiveJoin || !user?.id) return;
    if (!isConnected) {
      Alert.alert('Offline', 'Connect to the internet to join the group.');
      return;
    }
    setLinkingCurrent(true);
    try {
      const ok = await attachTripToSession(currentForLiveJoin.id, sessionId);
      if (!ok) {
        Alert.alert('Could not join', 'Try again.');
        return;
      }
      patchActiveTrip({ shared_session_id: sessionId });
      Alert.alert(
        'You’re in the group',
        'Keep logging on your trip — you’ll see the shared timeline with everyone in this session. Each person still has their own trip and fish count.',
        [{ text: 'OK', onPress: () => router.replace(`/trip/${currentForLiveJoin.id}`) }],
      );
    } finally {
      setLinkingCurrent(false);
    }
  };

  const runAutoCreateAndJoin = useCallback(async () => {
    if (!sessionId || !inviteId || !user?.id || !isConnected) return;
    if (currentForLiveJoin || blockingOtherSession) return;
    const at = useTripStore.getState().activeTrip;
    if (
      at?.status === 'active' &&
      !at.deleted_at &&
      at.user_id === user.id &&
      (at.shared_session_id ?? '').trim() === sessionId.trim()
    ) {
      router.replace(`/trip/${at.id}`);
      return;
    }
    if (autoJoinInFlightRef.current) return;
    autoJoinInFlightRef.current = true;

    setAutoCreating(true);
    setAutoFailed(false);
    try {
      const invite = await fetchSessionInviteById(inviteId);
      if (
        !invite ||
        invite.shared_session_id !== sessionId ||
        invite.invitee_id !== user.id ||
        invite.status !== 'accepted'
      ) {
        setAutoFailed(true);
        return;
      }

      const template = await resolveInviterTemplateTripForJoin(sessionId, invite);
      if (!template?.location_id || !template.fishing_type) {
        Alert.alert(
          'Could not set up trip',
          'We couldn’t load the fishing spot from this invite. Try again, or start a trip from the map and link it from People.',
        );
        setAutoFailed(true);
        return;
      }

      const fishingType = template.fishing_type as FishingType;
      const newTripId = await startTrip(
        user.id,
        template.location_id,
        fishingType,
        template.location ?? undefined,
        template.session_type ?? null,
      );

      const attached = await attachTripToSession(newTripId, sessionId);
      if (!attached) {
        Alert.alert('Trip started', 'Your outing was created but we couldn’t add it to the group. Try linking from People on this trip.');
        router.replace(`/trip/${newTripId}`);
        return;
      }

      patchActiveTrip({ shared_session_id: sessionId });
      router.replace(`/trip/${newTripId}`);
    } catch {
      setAutoFailed(true);
    } finally {
      autoJoinInFlightRef.current = false;
      setAutoCreating(false);
    }
  }, [
    sessionId,
    inviteId,
    user?.id,
    isConnected,
    currentForLiveJoin,
    blockingOtherSession,
    startTrip,
    patchActiveTrip,
    router,
  ]);

  useEffect(() => {
    if (!sessionId || !inviteId || !user?.id || !isConnected) return;
    if (currentForLiveJoin || blockingOtherSession) return;
    void runAutoCreateAndJoin();
  }, [
    sessionId,
    inviteId,
    user?.id,
    isConnected,
    currentForLiveJoin,
    blockingOtherSession,
    runAutoCreateAndJoin,
  ]);

  const handleSkip = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const handleRetryAuto = useCallback(() => {
    setAutoFailed(false);
    void runAutoCreateAndJoin();
  }, [runAutoCreateAndJoin]);

  if (!sessionId) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Text style={{ color: colors.text, padding: Spacing.md }}>Missing session. Go back and accept the invite again.</Text>
      </SafeAreaView>
    );
  }

  if (autoCreating && !currentForLiveJoin && !blockingOtherSession && inviteId) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
        <View style={[styles.topBar, { paddingTop: effectiveTop + Spacing.sm, borderBottomColor: colors.border }]}>
          <Pressable onPress={handleSkip} hitSlop={12}>
            <MaterialIcons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Join the group</Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.centeredBusy}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.busyText, { color: colors.textSecondary }]}>
            Starting your trip at the same spot and adding you to the group…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
      <View style={[styles.topBar, { paddingTop: effectiveTop + Spacing.sm, borderBottomColor: colors.border }]}>
        <Pressable onPress={handleSkip} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Join the group</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.lead, { color: colors.text }]}>
          Link your current outing to this fishing group. Everyone keeps their own trip — you only share a combined timeline
          while you fish together.
        </Text>

        {blockingOtherSession ? (
          <View style={[styles.sectionCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Finish your other group trip first</Text>
            <Text style={[styles.sectionBody, { color: colors.textSecondary }]}>
              You already have an active outing linked to another fishing group. End that trip (or leave the group from People)
              before joining this one.
            </Text>
          </View>
        ) : null}

        {currentForLiveJoin ? (
          <View style={[styles.sectionCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Your active trip</Text>
            <Text style={[styles.sectionBody, { color: colors.textSecondary }]}>
              Add this outing to the group. You’ll still log catches, flies, and notes on your own timeline.
            </Text>
            <Text style={[styles.currentTripLine, { color: colors.text }]} numberOfLines={2}>
              {currentForLiveJoin.location?.name ?? 'Current trip'}
            </Text>
            <Text style={[styles.currentTripMeta, { color: colors.textSecondary }]}>
              {formatTripDate(currentForLiveJoin.start_time)}
              {currentForLiveJoin.total_fish > 0
                ? ` · ${currentForLiveJoin.total_fish === 1 ? '1 fish' : `${currentForLiveJoin.total_fish} fish`}`
                : ''}
            </Text>
            <Pressable
              style={[
                styles.joinLiveBtn,
                { backgroundColor: colors.primary, opacity: !isConnected || linkingCurrent ? 0.5 : 1 },
              ]}
              onPress={() => void handleJoinWithCurrentOuting()}
              disabled={!isConnected || linkingCurrent}
            >
              {linkingCurrent ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={[styles.joinLiveBtnText, { color: colors.textInverse }]}>Join with this outing</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {!currentForLiveJoin && !blockingOtherSession && (autoFailed || (!inviteId && !autoCreating)) ? (
          <View style={[styles.empty, { borderColor: colors.border }]}>
            <MaterialIcons name="directions-walk" size={40} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {inviteId ? 'Couldn’t start your trip automatically' : 'Open this link from the invite'}
            </Text>
            <Text style={[styles.emptyHint, { color: colors.textSecondary }]}>
              {inviteId
                ? 'Check your connection and try again, or start an outing from Fish and link it from People on that trip.'
                : 'This screen needs a fresh invite link. Ask your friend to send the invite again, then accept it from the app.'}
            </Text>
            {inviteId && isConnected ? (
              <Pressable
                style={[styles.joinLiveBtn, { backgroundColor: colors.primary, marginTop: Spacing.md, alignSelf: 'stretch' }]}
                onPress={() => void handleRetryAuto()}
              >
                <Text style={[styles.joinLiveBtnText, { color: colors.textInverse }]}>Try again</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!isConnected ? (
          <View style={[styles.banner, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>
              {"You're offline — join when you have a connection."}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Pressable onPress={handleSkip} style={styles.skipBtn}>
          <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>Skip for now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centeredBusy: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  busyText: { fontSize: FontSize.md, textAlign: 'center', lineHeight: 22 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: FontSize.lg, fontWeight: '700' },
  body: { padding: Spacing.md, paddingBottom: Spacing.xl },
  lead: { fontSize: FontSize.md, lineHeight: 22, marginBottom: Spacing.md },
  sectionCard: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  sectionTitle: { fontSize: FontSize.sm, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: Spacing.xs },
  sectionBody: { fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.sm },
  currentTripLine: { fontSize: FontSize.md, fontWeight: '700', marginTop: Spacing.xs },
  currentTripMeta: { fontSize: FontSize.sm, marginTop: 4, marginBottom: Spacing.md },
  joinLiveBtn: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  joinLiveBtnText: { fontSize: FontSize.sm, fontWeight: '700' },
  banner: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  empty: {
    marginTop: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyTitle: { fontSize: FontSize.md, fontWeight: '700', marginTop: Spacing.sm, textAlign: 'center' },
  emptyHint: { fontSize: FontSize.sm, marginTop: Spacing.sm, textAlign: 'center', lineHeight: 20 },
  footer: {
    padding: Spacing.md,
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  skipBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
});
