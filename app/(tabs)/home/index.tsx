import GuideChat from '@/src/components/GuideChat';
import { FishHomeHero } from '@/src/components/home/FishHomeHero';
import { FishHomeRecap } from '@/src/components/home/FishHomeRecap';
import { FishHomeFlyQuickLinks } from '@/src/components/home/FishHomeFlyQuickLinks';
import { FishHomePlannedSection } from '@/src/components/home/FishHomePlannedSection';
import { FishHomeRightNow } from '@/src/components/home/FishHomeRightNow';
import { StreakMilestoneCard } from '@/src/components/home/StreakMilestoneCard';
import { TripSessionPeopleSheet } from '@/src/components/trip/TripSessionPeopleSheet';
import { FishHomeReport } from '@/src/components/home/FishHomeReport';
import { HomeSectionTabs, type HomeSectionKey } from '@/src/components/home/HomeSectionTabs';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useGuideChatContext } from '@/src/hooks/useGuideChatContext';
import { useHomeHotSpots } from '@/src/hooks/useHomeHotSpots';
import { useRecentCatchesRecap } from '@/src/hooks/useRecentCatchesRecap';
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
import { pushJournalTripDetail } from '@/src/utils/journalNavigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Keyboard,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Default height for the docked paused-trip header until `onLayout` runs (avoids overlap with chat). Includes optional bell row. */
const PAUSED_HOME_HEADER_FALLBACK = 220;

/** Duration/easing for the guide chat sliding to and from full screen. */
const GUIDE_EXPAND_DURATION = 320;
const GUIDE_EXPAND_EASING = Easing.out(Easing.cubic);

/** How far the content sheet rises up over the hero photo at rest (the rounded-top overlap). */
const SHEET_OVERLAP = 66;

function createHomeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    chatFlex: {
      flex: 1,
      minHeight: 0,
      // Clip the hero as it slides up past the top when the guide chat expands.
      overflow: 'hidden',
    },
    panels: {
      flex: 1,
      minHeight: 0,
    },
    /** White bottom half: rounded-top sheet that rises under the floating pills. */
    sheet: {
      flex: 1,
      minHeight: 0,
      marginTop: -SHEET_OVERLAP,
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.xl,
      borderTopRightRadius: BorderRadius.xl,
    },
    /** Discovery tabs (right now / hatch / spots) clear the rounded lip and keep the standard gutter. */
    sheetPanelContent: {
      paddingTop: Spacing.lg,
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.xxl + 88,
    },
    /**
     * Report panel: flexGrow keeps short content filling the frame (so it can't scroll into a big
     * empty dead-zone / trigger the collapse), and paddingBottom only clears the pinned action bar.
     */
    reportPanelContent: {
      flexGrow: 1,
      paddingTop: Spacing.lg,
      paddingHorizontal: Spacing.md,
      paddingBottom: 104,
    },
    panel: {
      flex: 1,
      minHeight: 0,
    },
    /** Inactive sections stay mounted so chat messages and expanded rows survive a tab switch. */
    panelHidden: {
      display: 'none',
    },
    panelScrollContent: {
      paddingTop: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.xxl + 88,
    },
    /** Welcome panel is full-bleed (hero + sheet manage their own insets). */
    welcomePanelContent: {
      paddingBottom: Spacing.xxl + 88,
    },
    /** Planned-trips section still expects the standard horizontal gutter. */
    welcomePlannedWrap: {
      paddingHorizontal: Spacing.md,
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
    /** Bell sitting on the hero photo: translucent dark disc so the white icon reads over sky or water. */
    heroBellBtn: {
      position: 'relative',
      width: 40,
      height: 40,
      borderRadius: BorderRadius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(15,23,42,0.42)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.28)',
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
  /**
   * The sectioned home (welcome / right now / hatch / spots / guide) only applies with no trip in
   * flight. An active or paused trip collapses back to plain chat so the trip stays the focus.
   */
  const showSectionTabs = !activeTrip;
  const { profile, user } = useAuthStore();
  const { isConnected } = useNetworkStatus();
  const [elapsed, setElapsed] = useState('0m');
  const [refreshing, setRefreshing] = useState(false);
  const [briefingRefreshKey, setBriefingRefreshKey] = useState(0);
  const [sessionInviteRows, setSessionInviteRows] = useState<
    { invite: SessionInvite; summaryLine: string }[]
  >([]);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [section, setSection] = useState<HomeSectionKey>('report');
  // When the guide composer is focused, the hero slides up and the chat fills the screen.
  const [guideExpanded, setGuideExpanded] = useState(false);
  // 0 = hero shown, 1 = hero fully slid up. Drives the animation on the UI thread.
  const guideProgress = useSharedValue(0);
  // Measured hero height: expanding pulls the hero up by exactly this much so the sheet fills.
  const heroHeight = useSharedValue(0);
  const onHeroLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = Math.round(e.nativeEvent.layout.height);
      if (h > 0) heroHeight.value = h;
    },
    [heroHeight],
  );
  // Shared scroll-collapse: the moment any panel scrolls at all, the hero snaps fully collapsed
  // (greeting + tabs stay pinned) so the content sheet expands up to just under the tabs. Scroll
  // back to the very top and it snaps open again.
  // collapseProgress: animated 0 (expanded) → 1 (fully collapsed). collapseTarget dedupes so we
  // only fire one withTiming per crossing rather than restarting it every scroll frame.
  const collapseProgress = useSharedValue(0);
  const collapseTarget = useSharedValue(0);
  // Bottom Y of the tab pills within the hero — the sheet collapses up to here, no further.
  const tabsBottom = useSharedValue(0);
  const onTabsLayout = useCallback(
    (bottomY: number) => {
      if (bottomY > 0) tabsBottom.value = bottomY;
    },
    [tabsBottom],
  );
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      const y = e.contentOffset.y;
      // One-way: a deliberate scroll past COLLAPSE_AT expands the sheet (collapses the hero) and it
      // STAYS expanded — returning to the top does not shrink it back (that was firing by accident).
      // The hero comes back only when you switch tabs (see the reset effect) or pull down past the top.
      const COLLAPSE_AT = 140;
      const PULL_TO_RESTORE = -70;
      let target = collapseTarget.value;
      if (target === 0 && y > COLLAPSE_AT) target = 1;
      else if (target === 1 && y < PULL_TO_RESTORE) target = 0;
      if (collapseTarget.value !== target) {
        collapseTarget.value = target;
        collapseProgress.value = withTiming(target, {
          duration: 300,
          easing: GUIDE_EXPAND_EASING,
        });
      }
    },
  });
  // Reset the collapse when switching tabs so a new panel opens with the hero expanded.
  useEffect(() => {
    collapseTarget.value = 0;
    collapseProgress.value = 0;
  }, [section, collapseTarget, collapseProgress]);
  const animateGuide = useCallback(
    (toExpanded: boolean) => {
      guideProgress.value = withTiming(toExpanded ? 1 : 0, {
        duration: GUIDE_EXPAND_DURATION,
        easing: GUIDE_EXPAND_EASING,
      });
    },
    [guideProgress],
  );
  const expandGuide = useCallback(() => {
    setGuideExpanded(true);
    animateGuide(true);
  }, [animateGuide]);
  const collapseGuide = useCallback(() => {
    Keyboard.dismiss();
    setGuideExpanded(false);
    animateGuide(false);
  }, [animateGuide]);
  // Leaving the guide section (only reachable once collapsed) should never strand the expanded state.
  useEffect(() => {
    if (section !== 'guide' && guideExpanded) collapseGuide();
  }, [section, guideExpanded, collapseGuide]);

  // Hero slides up off the top (guide expand); and on scroll it collapses from the bottom —
  // marginBottom pulls the sheet up over the photo below the tabs, keeping greeting + tabs pinned.
  const heroAnimStyle = useAnimatedStyle(() => {
    // Only collapse once the tabs' position is known (avoids over-collapsing before layout).
    const maxCollapse =
      tabsBottom.value > 0 ? Math.max(0, heroHeight.value - SHEET_OVERLAP - tabsBottom.value) : 0;
    const collapse = maxCollapse * collapseProgress.value * (1 - guideProgress.value);
    return {
      marginTop: -heroHeight.value * guideProgress.value,
      marginBottom: -collapse,
    };
  });
  const sheetAnimStyle = useAnimatedStyle(() => ({
    marginTop: -SHEET_OVERLAP * (1 - guideProgress.value),
  }));
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

  const getContext = useGuideChatContext();
  const { hotSpotList, hotSpotLoading, userCoords } = useHomeHotSpots(
    fullHome,
    briefingRefreshKey,
  );
  const {
    recentCatches,
    totalCatches,
    spotlight,
    locationNameByTripId,
    loading: recapLoading,
  } = useRecentCatchesRecap(briefingRefreshKey);

  /**
   * WS-G: a self-contained streak/milestone badge overlays the top-right of the home hero photo.
   * It renders nothing until there's a streak/PB/milestone, so a guest/new user sees nothing.
   */
  const streakBadge: ReactNode = <StreakMilestoneCard variant="badge" />;
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

  /** Location-denied / no-GPS fallback for the "Right now near you" hero: send to the map to pick a region. */
  const openMap = useCallback(() => {
    router.push('/map');
  }, [router]);

  const openHatchCalendar = useCallback(() => {
    router.push('/home/hatch-chart');
  }, [router]);

  const openBugMatcher = useCallback(() => {
    router.push('/bug-matcher');
  }, [router]);

  /** Welcome look-back: a catch opens its trip's Fishing tab and its full-screen photo. */
  const openCatchDetail = useCallback((row: { trip_id: string; event_id: string }) => {
    if (!row.trip_id) return;
    // A per-tap nonce makes the URL unique each time so re-tapping the same catch re-fires the
    // deep-link even when the singular navigation reuses the existing trip screen.
    const nonce = Date.now();
    const q = row.event_id
      ? `?focusCatchEventId=${encodeURIComponent(row.event_id)}&focusNonce=${nonce}`
      : `?focusNonce=${nonce}`;
    pushJournalTripDetail(`/journal/${row.trip_id}${q}` as Href);
  }, []);

  /** "See all" → Profile tab, Photos view. */
  const openProfilePhotos = useCallback(() => {
    router.push({ pathname: '/profile', params: { media: 'photos' } });
  }, [router]);

  const startFirstTrip = useCallback(() => {
    router.push('/trip/new');
  }, [router]);

  /** One descriptor shared by every section panel; each ScrollView instantiates its own control. */
  const homeRefreshControl = useMemo(
    () =>
      fullHome ? (
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      ) : undefined,
    [fullHome, refreshing, onRefresh, colors.primary],
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

  /** Always-visible bell for the hero (opens the invites modal; badge only when there are invites). */
  const inviteBell = useMemo(() => {
    const n = sessionInviteRows.length;
    return (
      <Pressable
        onPress={() => setInviteModalVisible(true)}
        style={styles.heroBellBtn}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={
          n > 0 ? `Notifications, ${n} fishing group invite${n === 1 ? '' : 's'}` : 'Notifications'
        }
      >
        <MaterialCommunityIcons name="bell-outline" size={22} color={colors.textInverse} />
        {n > 0 ? (
          <View style={styles.notifBadge} pointerEvents="none">
            <Text style={styles.notifBadgeText}>{n > 9 ? '9+' : String(n)}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }, [sessionInviteRows.length, styles, colors.textInverse]);

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
        {showSectionTabs ? (
          <>
            {/* Persistent hero: the photo, greeting, pills and bell stay put across tabs; only the sheet below swaps.
                Slides up off the top (negative margin = measured height) when the guide chat expands. */}
            <Animated.View onLayout={onHeroLayout} style={heroAnimStyle}>
              <FishHomeHero
                userFirstName={profileFirstName(profile)}
                tabs={<HomeSectionTabs active={section} onChange={setSection} variant="bar" />}
                bell={inviteBell}
                streakBadge={streakBadge}
                topInset={insets.top}
                onTabsLayout={onTabsLayout}
              />
            </Animated.View>
            <Animated.View style={[styles.sheet, sheetAnimStyle]}>
              <View style={styles.panels}>
              <View style={[styles.panel, section !== 'welcome' && styles.panelHidden]}>
                <Animated.ScrollView
                  contentContainerStyle={styles.welcomePanelContent}
                  refreshControl={homeRefreshControl}
                  onScroll={scrollHandler}
                  scrollEventThrottle={16}
                >
                  <FishHomeRecap
                    recentCatches={recentCatches}
                    totalCatches={totalCatches}
                    spotlight={spotlight}
                    locationNameByTripId={locationNameByTripId}
                    loading={recapLoading}
                    onOpenCatch={openCatchDetail}
                    onSeeAll={openProfilePhotos}
                    onStartFirstTrip={startFirstTrip}
                  />

                  {/* Planned trips are a signed-in feature — a guest/new user shouldn't see empty scaffolding. */}
                  {user?.id ? (
                    <View style={styles.welcomePlannedWrap}>
                      <FishHomePlannedSection
                        plannedTrips={plannedTrips}
                        plannedTripsLoading={plannedTripsLoading}
                        onStartTrip={handleStartPlannedTrip}
                        onDeleteTrip={handleDeletePlannedTrip}
                        onOpenGroupPeople={handleOpenPlannedGroupPeople}
                      />
                    </View>
                  ) : null}
                </Animated.ScrollView>
              </View>

              {/* Combined Right-now + Flies & hatch: a fly to tie on (from the active hatch), then
                  quick links to the calendar / bug matcher, then what's currently hatching. */}
              <View style={[styles.panel, section !== 'right-now' && styles.panelHidden]}>
                <Animated.ScrollView
                  contentContainerStyle={styles.sheetPanelContent}
                  refreshControl={homeRefreshControl}
                  onScroll={scrollHandler}
                  scrollEventThrottle={16}
                >
                  <FishHomeFlyQuickLinks
                    onOpenHatchCalendar={openHatchCalendar}
                    onMatchBug={openBugMatcher}
                  />
                  <FishHomeRightNow
                    rankedWatersCount={hotSpotList.length}
                    userCoords={userCoords}
                    userId={user?.id ?? null}
                    topWaterName={hotSpotList[0]?.location.name ?? null}
                    onBrowseMap={openMap}
                  />
                </Animated.ScrollView>
              </View>

              <View style={[styles.panel, section !== 'report' && styles.panelHidden]}>
                <FishHomeReport
                  hotSpotList={hotSpotList}
                  hotSpotLoading={hotSpotLoading}
                  onScroll={scrollHandler}
                  refreshControl={homeRefreshControl}
                  contentContainerStyle={styles.reportPanelContent}
                />
              </View>

              <View style={[styles.panel, section !== 'guide' && styles.panelHidden]}>
                <GuideChat
                  getContext={getContext}
                  variant="full"
                  contentTopPadding={guideExpanded ? insets.top + Spacing.sm : Spacing.md}
                  expanded={guideExpanded}
                  onRequestExpand={expandGuide}
                  onRequestCollapse={collapseGuide}
                />
              </View>
              </View>
            </Animated.View>
          </>
        ) : (
          <GuideChat
            getContext={getContext}
            variant="full"
            contentTopPadding={0}
            refreshControl={
              fullHome ? (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  colors={[colors.primary]}
                />
              ) : undefined
            }
          />
        )}
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
              {sessionInviteRows.length === 0 ? (
                <Text style={styles.groupInviteHint}>You're all caught up — no new notifications.</Text>
              ) : null}
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
