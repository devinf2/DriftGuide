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
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useTripStore } from '@/src/stores/tripStore';
import { fetchTripById, fetchTripsFromCloud } from '@/src/services/sync';
import {
  acceptSessionInvite,
  attachTripToSession,
  fetchSessionInviteById,
  findTripForUserInSession,
  resolveInviterTemplateTripForJoin,
} from '@/src/services/sharedSessionService';
import {
  canJoinSessionWithCurrentTrip,
  hasActiveTripBlockingSessionJoin,
  isCompletedTripInInviteMergeWindow,
  mergeWindowAnchorIso,
  plannedDateForUpcomingInvite,
  resolveSessionInviteFlow,
} from '@/src/utils/sessionInviteMergeTrips';
import { formatTripDate } from '@/src/utils/formatters';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import type { FishingType, SessionInvite, Trip } from '@/src/types';

export default function SessionLinkTripScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const effectiveTop = useEffectiveSafeTopInset();
  const { user } = useAuthStore();
  const activeTrip = useTripStore((s) => s.activeTrip);
  const planTrip = useTripStore((s) => s.planTrip);
  const fetchPlannedTrips = useTripStore((s) => s.fetchPlannedTrips);
  const patchActiveTrip = useTripStore((s) => s.patchActiveTrip);
  const clearActiveTrip = useTripStore((s) => s.clearActiveTrip);
  const { isConnected } = useNetworkStatus();
  const { sessionId, inviteId } = useLocalSearchParams<{ sessionId: string; inviteId?: string }>();

  const [linkingCurrent, setLinkingCurrent] = useState(false);
  const [linkingPastTripId, setLinkingPastTripId] = useState<string | null>(null);
  const [resolveLoading, setResolveLoading] = useState(true);
  const [invite, setInvite] = useState<SessionInvite | null>(null);
  const [template, setTemplate] = useState<Trip | null>(null);
  const [flowKind, setFlowKind] = useState<'upcoming' | 'past' | null>(null);
  const [upcomingBusy, setUpcomingBusy] = useState(false);
  const [upcomingFailed, setUpcomingFailed] = useState(false);
  const [pastPhase, setPastPhase] = useState<'menu' | 'pick_trip'>('menu');
  const [linkableTrips, setLinkableTrips] = useState<Trip[]>([]);
  const [linkableLoading, setLinkableLoading] = useState(false);

  const upcomingRanRef = useRef(false);

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

  /** Already linked to this session with an active outing — open trip. */
  useEffect(() => {
    if (!sessionId?.trim() || !user?.id || !activeTrip?.id || activeTrip.user_id !== user.id) return;
    if (activeTrip.status !== 'active' || activeTrip.deleted_at) return;
    if ((activeTrip.shared_session_id ?? '').trim() !== sessionId.trim()) return;
    router.replace(`/trip/${activeTrip.id}` as Href);
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

  useEffect(() => {
    if (!sessionId?.trim() || !inviteId?.trim() || !user?.id || !isConnected) {
      setResolveLoading(false);
      return;
    }
    let cancelled = false;
    setResolveLoading(true);
    void (async () => {
      const inv = await fetchSessionInviteById(inviteId.trim());
      if (cancelled) return;
      if (
        !inv ||
        inv.shared_session_id !== sessionId.trim() ||
        inv.invitee_id !== user.id ||
        inv.status !== 'pending'
      ) {
        setInvite(null);
        setTemplate(null);
        setFlowKind(null);
        setResolveLoading(false);
        return;
      }
      const tmpl = await resolveInviterTemplateTripForJoin(sessionId.trim(), inv);
      if (cancelled) return;
      const kind = resolveSessionInviteFlow(inv, tmpl);
      setInvite(inv);
      setTemplate(tmpl);
      setFlowKind(kind);
      const blocking = hasActiveTripBlockingSessionJoin(useTripStore.getState().activeTrip, sessionId.trim());
      if (kind === 'upcoming' && !blocking) {
        setUpcomingBusy(true);
      }
      setResolveLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, inviteId, user?.id, isConnected]);

  const runUpcomingSetup = useCallback(async () => {
    if (!sessionId?.trim() || !inviteId?.trim() || !user?.id || !isConnected) return;
    if (blockingOtherSession) return;

    setUpcomingBusy(true);
    setUpcomingFailed(false);
    try {
      const inv = await fetchSessionInviteById(inviteId.trim());
      if (
        !inv ||
        inv.shared_session_id !== sessionId.trim() ||
        inv.invitee_id !== user.id ||
        inv.status !== 'pending'
      ) {
        setUpcomingFailed(true);
        return;
      }

      const existing = await findTripForUserInSession(sessionId.trim(), user.id);
      if (existing?.shared_session_id === sessionId.trim()) {
        const joined = await acceptSessionInvite(inv, user.id);
        if (!joined) {
          setUpcomingFailed(true);
          return;
        }
        if (existing.status === 'planned') {
          await fetchPlannedTrips(user.id);
          router.replace('/(tabs)/home' as Href);
          return;
        }
        if (existing.status === 'active' && !existing.deleted_at) {
          router.replace(`/trip/${existing.id}` as Href);
          return;
        }
      }

      const tmpl = await resolveInviterTemplateTripForJoin(sessionId.trim(), inv);
      if (!tmpl?.location_id || !tmpl.fishing_type || !tmpl.location) {
        Alert.alert(
          'Could not set up trip',
          'We couldn’t load the fishing spot from this invite. Try again, or plan a trip from Home and link it from People on that trip.',
        );
        setUpcomingFailed(true);
        return;
      }

      const when = plannedDateForUpcomingInvite(tmpl);
      const plannedId = await planTrip(
        user.id,
        tmpl.location_id,
        tmpl.fishing_type as FishingType,
        tmpl.location,
        when,
        tmpl.session_type ?? null,
        tmpl.access_point_id ?? null,
      );
      if (!plannedId) {
        setUpcomingFailed(true);
        return;
      }

      const attached = await attachTripToSession(plannedId, sessionId.trim());
      if (!attached) {
        Alert.alert(
          'Almost there',
          'Your planned trip was created but we couldn’t attach it to the group. Try linking from People on that trip.',
        );
        setUpcomingFailed(true);
        return;
      }

      const joined = await acceptSessionInvite(inv, user.id);
      if (!joined) {
        Alert.alert(
          'Trip created',
          'Your planned trip was saved but we couldn’t finish joining the group. Open the invite from Home and try again.',
        );
        setUpcomingFailed(true);
        return;
      }

      await fetchPlannedTrips(user.id);
      router.replace('/(tabs)/home' as Href);
    } catch {
      setUpcomingFailed(true);
    } finally {
      setUpcomingBusy(false);
    }
  }, [
    sessionId,
    inviteId,
    user?.id,
    isConnected,
    blockingOtherSession,
    planTrip,
    fetchPlannedTrips,
    router,
  ]);

  useEffect(() => {
    if (flowKind !== 'upcoming' || !inviteId?.trim() || resolveLoading || !invite) return;
    if (blockingOtherSession) return;
    if (upcomingRanRef.current) return;
    upcomingRanRef.current = true;
    void runUpcomingSetup();
  }, [flowKind, inviteId, resolveLoading, invite, blockingOtherSession, runUpcomingSetup]);

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
      if (inviteId?.trim() && invite && invite.status === 'pending') {
        const joined = await acceptSessionInvite(invite, user.id);
        if (!joined) {
          Alert.alert('Could not finish join', 'Your trip was linked but the invite could not be completed. Try again from Home.');
          return;
        }
      }
      patchActiveTrip({ shared_session_id: sessionId });
      Alert.alert(
        'You’re in the group',
        'Keep logging on your trip — you’ll see the shared timeline with everyone in this session. Each person still has their own trip and fish count.',
        [{ text: 'OK', onPress: () => router.replace(`/trip/${currentForLiveJoin.id}` as Href) }],
      );
    } finally {
      setLinkingCurrent(false);
    }
  };

  const loadLinkableTrips = useCallback(async () => {
    if (!user?.id || !invite) return;
    setLinkableLoading(true);
    try {
      const anchor = mergeWindowAnchorIso(invite, template);
      const all = await fetchTripsFromCloud(user.id);
      const linkable = all.filter(
        (t) =>
          t.status === 'completed' &&
          !t.deleted_at &&
          !(t.shared_session_id?.trim()) &&
          isCompletedTripInInviteMergeWindow(t, anchor),
      );
      linkable.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
      setLinkableTrips(linkable);
      setPastPhase('pick_trip');
    } finally {
      setLinkableLoading(false);
    }
  }, [user?.id, invite, template]);

  const handleLinkPastTrip = async (tripRow: Trip) => {
    if (!sessionId?.trim() || !isConnected || !user?.id || !invite) return;
    setLinkingPastTripId(tripRow.id);
    try {
      const ok = await attachTripToSession(tripRow.id, sessionId.trim());
      if (!ok) {
        Alert.alert('Could not link', 'Try again.');
        return;
      }
      if (invite.status === 'pending') {
        const joined = await acceptSessionInvite(invite, user.id);
        if (!joined) {
          Alert.alert('Could not finish join', 'Your trip was linked but we could not complete the invite. Try again from Home.');
          return;
        }
      }
      router.replace(`/journal/${tripRow.id}` as Href);
    } finally {
      setLinkingPastTripId(null);
    }
  };

  const handleSkip = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home' as Href);
  }, [router]);

  const openImportForSession = () => {
    if (!sessionId?.trim()) return;
    router.push({
      pathname: '/trip/import-past',
      params: {
        linkSessionId: sessionId.trim(),
        ...(inviteId?.trim() ? { linkInviteId: inviteId.trim() } : {}),
      },
    } as Href);
  };

  if (!sessionId) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Text style={{ color: colors.text, padding: Spacing.md }}>Missing session. Go back and accept the invite again.</Text>
      </SafeAreaView>
    );
  }

  if (
    resolveLoading ||
    (flowKind === 'upcoming' && upcomingBusy && !upcomingFailed && !blockingOtherSession)
  ) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
        <View style={[styles.topBar, { paddingTop: effectiveTop + Spacing.sm, borderBottomColor: colors.border }]}>
          <Pressable onPress={handleSkip} hitSlop={12}>
            <MaterialIcons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Group invite</Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.centeredBusy}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.busyText, { color: colors.textSecondary }]}>
            {flowKind === 'upcoming'
              ? 'Adding a planned trip to your list so you can start when you’re ready…'
              : 'Loading…'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!inviteId || !invite || flowKind === null) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
        <View style={[styles.topBar, { paddingTop: effectiveTop + Spacing.sm, borderBottomColor: colors.border }]}>
          <Pressable onPress={handleSkip} hitSlop={12}>
            <MaterialIcons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Group invite</Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.lead, { color: colors.text }]}>
            This link is invalid or expired. Ask your friend to send a new invite, then accept it from the app.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (flowKind === 'upcoming' && (upcomingFailed || blockingOtherSession)) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
        <View style={[styles.topBar, { paddingTop: effectiveTop + Spacing.sm, borderBottomColor: colors.border }]}>
          <Pressable onPress={handleSkip} hitSlop={12}>
            <MaterialIcons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Group invite</Text>
          <View style={{ width: 28 }} />
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.lead, { color: colors.text }]}>
            {blockingOtherSession
              ? 'You already have an active outing linked to another fishing group. End that trip or leave the group from People, then try again.'
              : 'We couldn’t add your planned trip automatically. You can join with a current outing below, or try again.'}
          </Text>

          {blockingOtherSession ? null : (
            <Pressable
              style={[styles.joinLiveBtn, { backgroundColor: colors.primary, marginBottom: Spacing.md }]}
              onPress={() => {
                upcomingRanRef.current = false;
                void runUpcomingSetup();
              }}
            >
              <Text style={[styles.joinLiveBtnText, { color: colors.textInverse }]}>Try again</Text>
            </Pressable>
          )}

          {currentForLiveJoin && !blockingOtherSession ? (
            <View style={[styles.sectionCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Your active trip</Text>
              <Text style={[styles.sectionBody, { color: colors.textSecondary }]}>
                Link this outing to the group instead. You’ll still log catches on your own timeline.
              </Text>
              <Text style={[styles.currentTripLine, { color: colors.text }]} numberOfLines={2}>
                {currentForLiveJoin.location?.name ?? 'Current trip'}
              </Text>
              <Text style={[styles.currentTripMeta, { color: colors.textSecondary }]}>
                {formatTripDate(currentForLiveJoin.start_time)}
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

          {!isConnected ? (
            <View style={[styles.banner, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>You’re offline — connect to continue.</Text>
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

  if (flowKind === 'past') {
    const inviterLabel = template?.location?.name ?? 'Their trip';
    const inviterWhen = template ? formatTripDate(template.start_time) : null;

    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
        <View style={[styles.topBar, { paddingTop: effectiveTop + Spacing.sm, borderBottomColor: colors.border }]}>
          <Pressable onPress={handleSkip} hitSlop={12}>
            <MaterialIcons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Past outing</Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.lead, { color: colors.text }]}>
            Link one of your completed trips from around the same time to this group, or log a past trip with photos.
          </Text>

          <View style={[styles.sectionCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Trip you were invited to</Text>
            <Text style={[styles.currentTripLine, { color: colors.text }]}>{inviterLabel}</Text>
            {inviterWhen ? (
              <Text style={[styles.currentTripMeta, { color: colors.textSecondary }]}>{inviterWhen}</Text>
            ) : null}
          </View>

          {pastPhase === 'menu' ? (
            <>
              <Pressable
                style={[styles.joinLiveBtn, { backgroundColor: colors.primary, marginBottom: Spacing.sm }]}
                onPress={() => void loadLinkableTrips()}
                disabled={!isConnected || linkableLoading}
              >
                {linkableLoading ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={[styles.joinLiveBtnText, { color: colors.textInverse }]}>Link existing trip</Text>
                )}
              </Pressable>
              <Pressable
                style={[
                  styles.joinLiveBtn,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderWidth: 1,
                    borderColor: colors.border,
                  },
                ]}
                onPress={openImportForSession}
                disabled={!isConnected}
              >
                <Text style={[styles.joinLiveBtnText, { color: colors.text }]}>Log past trip</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable onPress={() => setPastPhase('menu')} style={{ marginBottom: Spacing.md }}>
                <Text style={{ color: colors.primary, fontWeight: '600' }}>← Back</Text>
              </Pressable>
              {linkableTrips.length === 0 ? (
                <Text style={[styles.sectionBody, { color: colors.textSecondary }]}>
                  No completed trips in the link window (about five days from their outing). Use Log past trip to add one.
                </Text>
              ) : (
                linkableTrips.map((t) => (
                  <Pressable
                    key={t.id}
                    style={[styles.sectionCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
                    onPress={() => void handleLinkPastTrip(t)}
                    disabled={linkingPastTripId !== null}
                  >
                    <Text style={[styles.currentTripLine, { color: colors.text }]} numberOfLines={2}>
                      {t.location?.name ?? 'Trip'}
                    </Text>
                    <Text style={[styles.currentTripMeta, { color: colors.textSecondary }]}>
                      {formatTripDate(t.start_time)}
                    </Text>
                    {linkingPastTripId === t.id ? (
                      <ActivityIndicator style={{ marginTop: Spacing.sm }} color={colors.primary} />
                    ) : null}
                  </Pressable>
                ))
              )}
            </>
          )}

          {!isConnected ? (
            <View style={[styles.banner, { borderColor: colors.border, backgroundColor: colors.surface, marginTop: Spacing.md }]}>
              <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>You’re offline — connect to link a trip.</Text>
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

  /** upcoming success navigates away; fallback empty */
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
      <View style={styles.centeredBusy}>
        <ActivityIndicator size="large" color={colors.primary} />
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
  footer: {
    padding: Spacing.md,
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  skipBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
});
