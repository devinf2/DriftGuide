import GuideChat from '@/src/components/GuideChat';
import { FishHomeHatchSection } from '@/src/components/home/FishHomeHatchSection';
import { FishHomeIntro } from '@/src/components/home/FishHomeIntro';
import { FishHomePlannedSection } from '@/src/components/home/FishHomePlannedSection';
import { TripSessionPeopleSheet } from '@/src/components/trip/TripSessionPeopleSheet';
import { FishHomeSpotsSection } from '@/src/components/home/FishHomeSpotsSection';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useGuideChatContext } from '@/src/hooks/useGuideChatContext';
import { useHomeHotSpots } from '@/src/hooks/useHomeHotSpots';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { fetchProfile } from '@/src/services/friendsService';
import {
  declineSessionInvite,
  listPendingSessionInvitesForUser,
  resolveInviterTemplateTripForJoin,
} from '@/src/services/sharedSessionService';
import { formatPendingSessionInviteSummary } from '@/src/utils/sessionInviteDisplay';
import { buildLinkTripAfterAcceptPath } from '@/src/utils/sessionInviteNavigation';
import { useAuthStore } from '@/src/stores/authStore';
import { useFriendsStore } from '@/src/stores/friendsStore';
import { usePlanTripHomeSuggestionsStore } from '@/src/stores/planTripHomeSuggestionsStore';
import { useTripStore } from '@/src/stores/tripStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { Trip, type SessionInvite } from '@/src/types';
import { formatFishCount } from '@/src/utils/formatters';
import { profileFirstName } from '@/src/utils/profileDisplay';
import { formatFishingElapsedLabel, getLiveFishingElapsedMs } from '@/src/utils/tripTiming';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Default height for the docked paused-trip header until `onLayout` runs (avoids overlap with chat). Includes optional bell row. */
const PAUSED_HOME_HEADER_FALLBACK = 220;

function createHomeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    chatFlex: {
      flex: 1,
      minHeight: 0,
    },
    pausedTripHeaderOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 20,
      elevation: 20,
    },
    activeTripWrapper: {
      flex: 1,
      padding: Spacing.xl,
    },
    pausedTripCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      marginBottom: Spacing.sm,
    },
    pausedTripHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    pausedTripMain: {
      flex: 1,
      minWidth: 0,
    },
    pausedTripTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    pausedTripLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.warning,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      flexShrink: 0,
    },
    pausedTripSummary: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
      flexShrink: 1,
      minWidth: 0,
      textAlign: 'right',
    },
    pausedTripTitle: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginTop: 4,
    },
    pausedTripActions: {
      flexDirection: 'row',
      gap: Spacing.sm,
      alignItems: 'center',
      marginTop: Spacing.sm,
    },
    resumeTripBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.sm,
    },
    resumeTripBtnText: {
      color: colors.textInverse,
      fontSize: FontSize.sm,
      fontWeight: '700',
    },
    endTripFromHomeBtn: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.error,
    },
    endTripFromHomeBtnText: {
      color: colors.error,
      fontSize: FontSize.sm,
      fontWeight: '600',
    },
    groupInviteBlock: {
      marginBottom: Spacing.md,
    },
    groupInviteBlockLast: {
      marginBottom: 0,
    },
    groupInviteHint: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: Spacing.sm,
    },
    groupInviteBtnRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      alignItems: 'center',
    },
    acceptInviteBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.sm,
    },
    acceptInviteBtnText: {
      color: colors.textInverse,
      fontSize: FontSize.sm,
      fontWeight: '700',
    },
    declineInviteBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    declineInviteBtnText: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: '600',
    },
    notifBellBtn: {
      position: 'relative',
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    notifBadge: {
      position: 'absolute',
      top: 0,
      right: -2,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    notifBadgeText: {
      color: colors.textInverse,
      fontSize: 10,
      fontWeight: '800',
    },
    inviteModalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-start',
    },
    inviteModalCard: {
      marginHorizontal: Spacing.md,
      marginTop: Spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      maxHeight: '78%',
      overflow: 'hidden',
    },
    inviteModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    inviteModalTitle: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
      flex: 1,
      paddingRight: Spacing.sm,
    },
    inviteModalScroll: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.xl,
    },
    activeTripCard: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.lg,
      padding: Spacing.xl,
    },
    activeTripLabel: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: 'rgba(255,255,255,0.7)',
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    activeTripLocation: {
      fontSize: FontSize.xxl,
      fontWeight: '700',
      color: colors.textInverse,
      marginTop: Spacing.xs,
    },
    activeTripStats: {
      flexDirection: 'row',
      marginTop: Spacing.lg,
      gap: Spacing.lg,
    },
    stat: {
      flex: 1,
    },
    statValue: {
      fontSize: FontSize.xl,
      fontWeight: '700',
      color: colors.textInverse,
    },
    statLabel: {
      fontSize: FontSize.xs,
      color: 'rgba(255,255,255,0.7)',
      marginTop: 2,
    },
    tapHint: {
      fontSize: FontSize.sm,
      color: 'rgba(255,255,255,0.5)',
      textAlign: 'center',
      marginTop: Spacing.lg,
    },
  });
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createHomeStyles(colors), [colors]);
  const {
    activeTrip,
    isTripPaused,
    fishCount,
    currentFly,
    endTrip,
    plannedTrips,
    plannedTripsLoading,
    fetchPlannedTrips,
    startPlannedTrip,
    deletePlannedTrip,
  } = useTripStore();
  /** Load / refresh regional briefing and planned trips when not in active (live) trip mode. */
  const fullHome = !activeTrip || isTripPaused;
  /** Fish tab discovery sections (intro, plans, hatch, spots) — hide while an active trip exists, including when paused. */
  const showHomeDiscoveryInChat = !activeTrip;
  const { profile, user } = useAuthStore();
  const { isConnected } = useNetworkStatus();
  const [elapsed, setElapsed] = useState('0m');
  const [refreshing, setRefreshing] = useState(false);
  const [briefingRefreshKey, setBriefingRefreshKey] = useState(0);
  const [sessionInviteRows, setSessionInviteRows] = useState<
    { invite: SessionInvite; summaryLine: string }[]
  >([]);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [plannedPeopleTrip, setPlannedPeopleTrip] = useState<Trip | null>(null);
  const [pausedHomeHeaderHeight, setPausedHomeHeaderHeight] = useState(PAUSED_HOME_HEADER_FALLBACK);
  const onPausedHomeHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    if (h > 0) setPausedHomeHeaderHeight(h);
  }, []);
  const friendships = useFriendsStore((s) => s.friendships);
  const refreshFriends = useFriendsStore((s) => s.refresh);

  const loadSessionInvites = useCallback(async () => {
    const uid = user?.id;
    if (!uid) {
      setSessionInviteRows([]);
      return;
    }
    const list = await listPendingSessionInvitesForUser(uid);
    const rows = await Promise.all(
      list.map(async (inv) => {
        const [p, templateTrip] = await Promise.all([
          fetchProfile(inv.inviter_id),
          resolveInviterTemplateTripForJoin(inv.shared_session_id, inv),
        ]);
        const inviterName = p?.display_name?.trim() || 'A friend';
        return {
          invite: inv,
          summaryLine: formatPendingSessionInviteSummary(inviterName, inv, templateTrip),
        };
      }),
    );
    setSessionInviteRows(rows);
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadSessionInvites();
    }, [loadSessionInvites]),
  );

  useEffect(() => {
    if (inviteModalVisible && sessionInviteRows.length === 0) {
      setInviteModalVisible(false);
    }
  }, [inviteModalVisible, sessionInviteRows.length]);

  const getContext = useGuideChatContext();
  const { hotSpotList, hotSpotLoading, userCoords, hatchRows, hatchLoading } = useHomeHotSpots(
    fullHome,
    briefingRefreshKey,
  );
  const setFromHomeHotSpots = usePlanTripHomeSuggestionsStore((s) => s.setFromHomeHotSpots);

  useEffect(() => {
    if (fullHome) setFromHomeHotSpots(hotSpotList);
  }, [fullHome, hotSpotList, setFromHomeHotSpots]);

  useEffect(() => {
    if (!activeTrip) return;
    const tick = () => {
      const s = useTripStore.getState();
      const ms = getLiveFishingElapsedMs(
        s.fishingElapsedMs,
        s.fishingSegmentStartedAt,
        s.isTripPaused,
        s.activeTrip?.start_time ?? null,
      );
      setElapsed(formatFishingElapsedLabel(ms));
    };
    if (isTripPaused) {
      tick();
      return;
    }
    const interval = setInterval(tick, 1000);
    tick();
    return () => clearInterval(interval);
  }, [activeTrip, isTripPaused]);

  useEffect(() => {
    if (user && fullHome) {
      fetchPlannedTrips(user.id);
    }
  }, [user, fullHome, fetchPlannedTrips]);

  const handleStartPlannedTrip = useCallback(
    async (tripId: string) => {
      const result = await startPlannedTrip(tripId);
      if (result) {
        router.push(`/trip/${result}`);
      }
    },
    [startPlannedTrip, router],
  );

  const handleDeletePlannedTrip = useCallback(
    (trip: Trip) => {
      Alert.alert(
        'Delete Plan',
        `Remove "${trip.location?.name || 'this trip'}" from your plans?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => deletePlannedTrip(trip.id),
          },
        ],
      );
    },
    [deletePlannedTrip],
  );

  const handleOpenPlannedGroupPeople = useCallback(
    (trip: Trip) => {
      if (user?.id) void refreshFriends(user.id);
      setPlannedPeopleTrip(trip);
    },
    [user?.id, refreshFriends],
  );

  const handlePlannedPeopleSessionChanged = useCallback(
    (nextSessionId: string | null) => {
      setPlannedPeopleTrip((prev) => (prev ? { ...prev, shared_session_id: nextSessionId } : null));
      if (user?.id) void fetchPlannedTrips(user.id);
    },
    [user?.id, fetchPlannedTrips],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user?.id && fullHome) fetchPlannedTrips(user.id);
    if (fullHome) setBriefingRefreshKey((k) => k + 1);
    void loadSessionInvites();
    setRefreshing(false);
  }, [user?.id, fullHome, fetchPlannedTrips, loadSessionInvites]);

  const handleResumeTrip = useCallback(() => {
    const s = useTripStore.getState();
    if (!s.activeTrip?.id || !s.isTripPaused) return;
    const tripId = s.activeTrip.id;
    void s.resumeTrip();
    router.push(`/trip/${tripId}`);
  }, [router]);

  const handleAcceptSessionInvite = useCallback(
    async (inv: SessionInvite) => {
      const uid = user?.id;
      if (!uid) return;
      if (!isConnected) {
        Alert.alert('Offline', 'Connect to the internet to continue this invite.');
        return;
      }
      setInviteModalVisible(false);
      router.push(buildLinkTripAfterAcceptPath(inv) as Href);
      await loadSessionInvites();
    },
    [user?.id, isConnected, loadSessionInvites, router],
  );

  const handleDeclineSessionInvite = useCallback(
    async (inv: SessionInvite) => {
      if (!isConnected) {
        Alert.alert('Offline', 'Connect to the internet to decline this invite.');
        return;
      }
      const ok = await declineSessionInvite(inv.id);
      if (!ok) {
        Alert.alert('Could not decline', 'Try again in a moment.');
        return;
      }
      void loadSessionInvites();
    },
    [isConnected, loadSessionInvites],
  );

  const handleEndTripFromHome = useCallback(() => {
    if (!activeTrip) return;
    const endMsg = activeTrip.shared_session_id
      ? `This ends only your trip. Friends in your fishing group keep their own trips; the group stays active.\n\nEnd with ${formatFishCount(fishCount)}?`
      : `End this trip with ${formatFishCount(fishCount)}?`;
    Alert.alert('End Trip', endMsg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End Trip',
        style: 'destructive',
        onPress: async () => {
          const { synced } = await endTrip();
          if (!synced) {
            Alert.alert(
              'Saved on device',
              "Trip will sync when you're back online or when you open the app with connection.",
              [{ text: 'OK' }],
            );
          }
          router.replace(`/trip/${activeTrip.id}/survey`);
        },
      },
    ]);
  }, [activeTrip, fishCount, endTrip, router]);

  const openSpot = useCallback(
    (locationId: string) => {
      router.push(`/spot/${locationId}`);
    },
    [router],
  );

  const showInviteNotificationBell = sessionInviteRows.length > 0 && Boolean(user?.id);

  const inviteBellAccessory = useMemo(() => {
    if (!showInviteNotificationBell) return null;
    const n = sessionInviteRows.length;
    return (
      <Pressable
        onPress={() => setInviteModalVisible(true)}
        style={styles.notifBellBtn}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Notifications, ${n} fishing group invite${n === 1 ? '' : 's'}`}
      >
        <MaterialCommunityIcons name="bell-outline" size={24} color={colors.text} />
        <View style={styles.notifBadge} pointerEvents="none">
          <Text style={styles.notifBadgeText}>{n > 9 ? '9+' : String(n)}</Text>
        </View>
      </Pressable>
    );
  }, [showInviteNotificationBell, sessionInviteRows.length, styles, colors.text]);

  if (activeTrip && !isTripPaused) {
    return (
      <View style={[styles.container, { paddingTop: effectiveTop }]}>
        <View style={styles.activeTripWrapper}>
          <Pressable
            style={styles.activeTripCard}
            onPress={() => router.push(`/trip/${activeTrip.id}`)}
          >
            <Text style={styles.activeTripLabel}>Active Trip</Text>
            <Text style={styles.activeTripLocation}>
              {activeTrip.location?.name || 'Fishing Trip'}
            </Text>
            <View style={styles.activeTripStats}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{elapsed}</Text>
                <Text style={styles.statLabel}>Fishing time</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{fishCount}</Text>
                <Text style={styles.statLabel}>Fish</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{currentFly?.pattern || '\u2014'}</Text>
                <Text style={styles.statLabel}>Current Fly</Text>
              </View>
            </View>
            <Text style={styles.tapHint}>Tap to open trip dashboard</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.chatFlex,
          activeTrip && isTripPaused ? { paddingTop: pausedHomeHeaderHeight } : null,
        ]}
      >
        <GuideChat
          getContext={getContext}
          variant="full"
          contentTopPadding={activeTrip && isTripPaused ? 0 : insets.top}
          {...(inviteBellAccessory && !(activeTrip && isTripPaused)
            ? { topBarAccessory: inviteBellAccessory }
            : {})}
          refreshControl={
            fullHome ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            ) : undefined
          }
          listHeaderComponent={
            showHomeDiscoveryInChat ? (
              <View>
                <FishHomeIntro
                  userFirstName={profileFirstName(profile)}
                  briefingLoading={hotSpotLoading}
                  rankedWatersCount={hotSpotList.length}
                />
                <FishHomePlannedSection
                  plannedTrips={plannedTrips}
                  plannedTripsLoading={plannedTripsLoading}
                  onStartTrip={handleStartPlannedTrip}
                  onDeleteTrip={handleDeletePlannedTrip}
                  onOpenGroupPeople={user?.id ? handleOpenPlannedGroupPeople : undefined}
                />
                <FishHomeHatchSection loading={hatchLoading} rows={hatchRows} />
                <FishHomeSpotsSection
                  hotSpotLoading={hotSpotLoading}
                  hotSpotList={hotSpotList}
                  onOpenSpot={openSpot}
                />
              </View>
            ) : undefined
          }
        />
      </View>

      {activeTrip && isTripPaused && (
        <View style={styles.pausedTripHeaderOverlay} onLayout={onPausedHomeHeaderLayout}>
          <View
            style={{
              backgroundColor: colors.background,
              paddingTop: effectiveTop + Spacing.sm,
            paddingHorizontal: Spacing.xl,
            paddingBottom: Spacing.sm,
          }}
        >
            {inviteBellAccessory ? (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  marginBottom: Spacing.xs,
                }}
              >
                {inviteBellAccessory}
              </View>
            ) : null}
            <View style={[styles.pausedTripCard, { marginBottom: 0 }]}>
              <Pressable
                style={styles.pausedTripHeader}
                onPress={() => router.push(`/trip/${activeTrip.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Paused trip, ${activeTrip.location?.name || 'Fishing Trip'}`}
                accessibilityHint="Opens trip dashboard"
              >
                <View style={styles.pausedTripMain}>
                  <View style={styles.pausedTripTopRow}>
                    <Text style={styles.pausedTripLabel}>Trip paused</Text>
                    <Text style={styles.pausedTripSummary} numberOfLines={1}>
                      {elapsed} · {fishCount === 1 ? '1 fish' : `${fishCount} fish`}
                    </Text>
                  </View>
                  <Text style={styles.pausedTripTitle} numberOfLines={1}>
                    {activeTrip.location?.name || 'Fishing Trip'}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textTertiary} />
              </Pressable>
              <View style={styles.pausedTripActions}>
                <Pressable style={styles.resumeTripBtn} onPress={handleResumeTrip}>
                  <MaterialCommunityIcons name="play" size={20} color={colors.textInverse} />
                  <Text style={styles.resumeTripBtnText}>Resume</Text>
                </Pressable>
                <Pressable style={styles.endTripFromHomeBtn} onPress={handleEndTripFromHome}>
                  <Text style={styles.endTripFromHomeBtnText}>End trip</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      )}

      <Modal
        visible={inviteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInviteModalVisible(false)}
      >
        <View style={[styles.inviteModalBackdrop, { paddingTop: insets.top + Spacing.sm }]}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setInviteModalVisible(false)}
            accessibilityLabel="Dismiss notifications"
          />
          <View style={styles.inviteModalCard}>
            <View style={styles.inviteModalHeader}>
              <Text style={styles.inviteModalTitle}>Fishing group invites</Text>
              <Pressable
                onPress={() => setInviteModalVisible(false)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView
              style={{ maxHeight: 420 }}
              contentContainerStyle={styles.inviteModalScroll}
              keyboardShouldPersistTaps="handled"
            >
              {sessionInviteRows.map(({ invite, summaryLine }, idx) => (
                <View
                  key={invite.id}
                  style={[
                    styles.groupInviteBlock,
                    idx === sessionInviteRows.length - 1 ? styles.groupInviteBlockLast : undefined,
                  ]}
                >
                  <Text style={styles.groupInviteHint}>{summaryLine}</Text>
                  <View style={styles.groupInviteBtnRow}>
                    <Pressable
                      style={[styles.acceptInviteBtn, !isConnected && { opacity: 0.5 }]}
                      onPress={() => void handleAcceptSessionInvite(invite)}
                      disabled={!isConnected}
                      accessibilityRole="button"
                      accessibilityLabel="Continue fishing group invite"
                    >
                      <Text style={styles.acceptInviteBtnText}>Continue</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.declineInviteBtn, !isConnected && { opacity: 0.5 }]}
                      onPress={() => void handleDeclineSessionInvite(invite)}
                      disabled={!isConnected}
                      accessibilityRole="button"
                      accessibilityLabel="Decline fishing group invite"
                    >
                      <Text style={styles.declineInviteBtnText}>Decline</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {user?.id ? (
        <TripSessionPeopleSheet
          visible={plannedPeopleTrip !== null}
          onClose={() => setPlannedPeopleTrip(null)}
          tripId={plannedPeopleTrip?.id ?? ''}
          userId={user.id}
          sharedSessionId={plannedPeopleTrip?.shared_session_id ?? null}
          acceptedFriendships={friendships}
          onSessionChanged={handlePlannedPeopleSessionChanged}
        />
      ) : null}
    </View>
  );
}
