import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { JournalFishingTimeline } from '@/src/components/journal/JournalFishingTimeline';
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { usePendingTripPayloadForTrip } from '@/src/hooks/usePendingTripPayload';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useTripStore } from '@/src/stores/tripStore';
import { fetchTripEvents } from '@/src/services/sync';
import {
  fetchMergedSessionEventsForTrips,
  listSessionMembers,
  listTripsInSession,
} from '@/src/services/sharedSessionService';
import { fetchProfile } from '@/src/services/friendsService';
import type { TripEndpointKind } from '@/src/components/journal/TripEndpointPinModal';
import type { CatchData, Trip, TripEvent, TripEventWithSource } from '@/src/types';
import { mergeCatchDataPhotoUrls, normalizeCatchPhotoUrls } from '@/src/utils/catchPhotos';
import {
  filterEventsToViewerTripLog,
  sortEventsByTime,
  totalFishFromEvents,
} from '@/src/utils/journalTimeline';

/** `group` = merged session feed; otherwise a child `trip.id` in the session (including the viewer’s). */
type TimelineMode = 'group' | string;

function isTripEventWithSource(e: TripEvent): e is TripEventWithSource {
  return (
    'source_display_name' in e &&
    typeof (e as TripEventWithSource).source_display_name === 'string' &&
    typeof (e as TripEventWithSource).source_user_id === 'string' &&
    typeof (e as TripEventWithSource).source_trip_id === 'string'
  );
}

function mergeSourceTripId(e: TripEvent): string | undefined {
  if (isTripEventWithSource(e)) return e.source_trip_id;
  return e.trip_id;
}

function fishCountForSourceTrip(events: TripEvent[], childTripId: string): number {
  return totalFishFromEvents(
    events.filter((e) => mergeSourceTripId(e) === childTripId),
  );
}

function tripEventStripSource(e: TripEventWithSource): TripEvent {
  const { source_user_id: _u, source_display_name: _n, source_trip_id: _t, ...rest } = e;
  return rest as TripEvent;
}

/** Server merge only includes trips with `shared_session_id` set; add local rows so "Me" always appears in Group. */
function mergeLocalTripIntoGroupTimeline(
  remote: TripEventWithSource[],
  localTripId: string,
  localUserId: string,
  myDisplayName: string,
  localEvents: TripEvent[],
): TripEventWithSource[] {
  const byId = new Map<string, TripEventWithSource>();
  for (const e of remote) {
    byId.set(e.id, e);
  }
  for (const e of localEvents) {
    if (e.trip_id !== localTripId) continue;
    const existing = byId.get(e.id);
    if (existing) {
      if (e.event_type === 'catch' && existing.event_type === 'catch') {
        const mergedData = mergeCatchDataPhotoUrls(existing.data as CatchData, e.data as CatchData);
        const before = normalizeCatchPhotoUrls(existing.data as CatchData).length;
        const after = normalizeCatchPhotoUrls(mergedData).length;
        if (after > before) {
          byId.set(e.id, { ...existing, data: mergedData });
        }
      }
      continue;
    }
    byId.set(e.id, {
      ...e,
      source_user_id: localUserId,
      source_display_name: myDisplayName,
      source_trip_id: localTripId,
    });
  }
  return sortEventsByTime([...byId.values()]) as TripEventWithSource[];
}

export interface SharedTripTimelineSectionProps {
  trip: Trip;
  userId: string;
  isConnected: boolean;
  /** Local timeline (always the viewing user's trip). */
  events: TripEvent[];
  editMode: boolean;
  onEventsChange: (events: TripEvent[]) => void;
  onTripPatch: (patch: Partial<Trip>) => void;
  onCatchPhotoPress?: (event: TripEvent) => void;
  onRequestEditTripPin?: (kind: TripEndpointKind) => void;
  /** Poll interval ms for Group when online (default 15000). */
  groupPollMs?: number;
}

export function SharedTripTimelineSection({
  trip,
  userId,
  isConnected,
  events,
  editMode,
  onEventsChange,
  onTripPatch,
  onCatchPhotoPress,
  onRequestEditTripPin,
  groupPollMs = 15000,
}: SharedTripTimelineSectionProps) {
  const { colors } = useAppTheme();
  const sessionId = trip.shared_session_id ?? null;
  const pendingSyncTrips = useTripStore((s) => s.pendingSyncTrips);
  const pendingPayload = usePendingTripPayloadForTrip(trip.id, trip.user_id === userId);

  const [members, setMembers] = useState<
    { user_id: string; display_name: string; avatar_url: string | null }[]
  >([]);
  /** Default to this trip’s timeline so the Fish tab is never a silent merge of multiple trips. */
  const [timelineMode, setTimelineMode] = useState<TimelineMode>(() => trip.id);
  const [sessionChildTrips, setSessionChildTrips] = useState<Trip[]>([]);
  const [groupEvents, setGroupEvents] = useState<TripEventWithSource[]>([]);
  const [peerEvents, setPeerEvents] = useState<TripEvent[]>([]);
  const [peerTripForPeerMode, setPeerTripForPeerMode] = useState<Trip | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);

  const showTimelineSync = useMemo(
    () =>
      trip.user_id === userId && (!sessionId || timelineMode === 'group' || timelineMode === trip.id),
    [trip.user_id, userId, sessionId, timelineMode, trip.id],
  );

  const eventSyncStatusForEvent = useCallback(
    (ev: TripEvent) => {
      if (!showTimelineSync) return 'synced' as const;
      if (ev.trip_id !== trip.id) return 'synced' as const;
      if (!pendingSyncTrips.includes(trip.id)) return 'synced' as const;
      return pendingPayload?.eventSyncState?.[ev.id] ?? ('pending' as const);
    },
    [showTimelineSync, trip.id, pendingSyncTrips, pendingPayload],
  );

  const noopEvents = useCallback(() => {}, []);
  const noopTripPatch = useCallback(() => {}, []);

  const loadMembers = useCallback(async () => {
    if (!sessionId || !isConnected) {
      setMembers([]);
      return;
    }
    const raw = await listSessionMembers(sessionId);
    const enriched: { user_id: string; display_name: string; avatar_url: string | null }[] = [];
    for (const m of raw) {
      const p = await fetchProfile(m.user_id);
      const av = p?.avatar_url?.trim();
      enriched.push({
        user_id: m.user_id,
        display_name: p?.display_name?.trim() || 'Angler',
        avatar_url: av || null,
      });
    }
    setMembers(enriched);
  }, [sessionId, userId, isConnected]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  /**
   * One chip per linked child trip. Always include the open trip when in a session so “You” exists
   * offline or before `listTripsInSession` returns.
   */
  const sessionTripTabOptions = useMemo(() => {
    if (!sessionId) return [];
    const rows = sessionChildTrips.slice();
    if (!rows.some((r) => r.id === trip.id)) {
      rows.push(trip);
    }
    rows.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    return rows.map((t) => {
      const m = members.find((x) => x.user_id === t.user_id);
      const name = m?.display_name?.trim() || 'Angler';
      const label = t.id === trip.id ? 'You' : name;
      return {
        tripId: t.id,
        userId: t.user_id,
        label,
      };
    });
  }, [sessionChildTrips, trip, sessionId, members]);

  const sessionTripIds = useMemo(() => sessionTripTabOptions.map((p) => p.tripId), [sessionTripTabOptions]);

  const myTripEvents = useMemo(
    () => filterEventsToViewerTripLog(events, trip.id, userId),
    [events, trip.id, userId],
  );

  const avatarUriByUserId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const row of members) {
      map.set(row.user_id, row.avatar_url);
    }
    return map;
  }, [members]);

  const loadGroup = useCallback(async () => {
    if (!sessionId) {
      setGroupEvents([]);
      setSessionChildTrips([]);
      return;
    }
    if (!isConnected) {
      return;
    }
    setLoadingRemote(true);
    try {
      const trips = await listTripsInSession(sessionId);
      setSessionChildTrips(trips);
      const merged = await fetchMergedSessionEventsForTrips(trips);
      setGroupEvents(merged);
    } finally {
      setLoadingRemote(false);
    }
  }, [sessionId, isConnected]);

  const loadPeer = useCallback(
    async (peerTripId: string) => {
      if (!sessionId || !isConnected) return;
      setLoadingRemote(true);
      try {
        const trips = await listTripsInSession(sessionId);
        const peerTrip = trips.find((t) => t.id === peerTripId) ?? null;
        setPeerTripForPeerMode(peerTrip);
        if (peerTrip) {
          setPeerEvents(await fetchTripEvents(peerTrip.id));
        } else {
          setPeerEvents([]);
        }
      } finally {
        setLoadingRemote(false);
      }
    },
    [sessionId, isConnected],
  );

  /** Keep merged events loaded for Group tab + fish badges on all chips (not only when Group is selected). */
  useEffect(() => {
    if (!sessionId || !isConnected) return;
    void loadGroup();
  }, [sessionId, isConnected, loadGroup]);

  useEffect(() => {
    if (!sessionId || !isConnected) return;
    const t = setInterval(() => void loadGroup(), groupPollMs);
    return () => clearInterval(t);
  }, [sessionId, isConnected, loadGroup, groupPollMs]);

  useEffect(() => {
    if (!sessionId || !isConnected) return;
    if (timelineMode !== 'group' && timelineMode !== trip.id && sessionTripIds.includes(timelineMode)) {
      void loadPeer(timelineMode);
    }
  }, [sessionId, isConnected, timelineMode, loadPeer, sessionTripIds, trip.id]);

  useEffect(() => {
    if (!sessionId) return;
    if (timelineMode === 'group') return;
    // Stay on "You" while session metadata loads; avoid briefly switching to Group (mixed feed).
    if (timelineMode === trip.id) return;
    if (sessionTripIds.length === 0) return;
    if (!sessionTripIds.includes(timelineMode)) {
      setTimelineMode(sessionTripIds.includes(trip.id) ? trip.id : 'group');
    }
  }, [sessionId, timelineMode, sessionTripIds, trip.id]);

  const myGroupTimelineLabel = useMemo(
    () => members.find((m) => m.user_id === userId)?.display_name?.trim() || 'You',
    [members, userId],
  );

  const groupTimelineEvents = useMemo(() => {
    if (!sessionId) return [] as TripEventWithSource[];
    return mergeLocalTripIntoGroupTimeline(
      groupEvents,
      trip.id,
      userId,
      myGroupTimelineLabel,
      myTripEvents,
    );
  }, [sessionId, groupEvents, trip.id, userId, myGroupTimelineLabel, myTripEvents]);

  /** When a direct fetch fails or is stale, peer rows still exist on the merged group feed after polling. */
  const peerEventsFromGroupMerge = useMemo(() => {
    if (timelineMode === 'group' || timelineMode === trip.id || !sessionTripIds.includes(timelineMode)) {
      return [] as TripEvent[];
    }
    const tid = timelineMode;
    return groupTimelineEvents
      .filter((e) => mergeSourceTripId(e) === tid)
      .map((e) => (isTripEventWithSource(e) ? tripEventStripSource(e) : e));
  }, [groupTimelineEvents, timelineMode, sessionTripIds, trip.id]);

  if (!sessionId) {
    return (
      <JournalFishingTimeline
        trip={trip}
        events={events}
        userId={userId}
        isConnected={isConnected}
        editMode={editMode}
        onEventsChange={onEventsChange}
        onTripPatch={onTripPatch}
        onCatchPhotoPress={onCatchPhotoPress}
        onRequestEditTripPin={onRequestEditTripPin}
        colorTokens={colors}
        eventSyncStatusForEvent={showTimelineSync ? eventSyncStatusForEvent : undefined}
      />
    );
  }

  const offlineBlock = !isConnected && (timelineMode === 'group' || timelineMode !== trip.id);
  const peerLabel =
    timelineMode !== 'group' && timelineMode !== trip.id
      ? sessionTripTabOptions.find((p) => p.tripId === timelineMode)?.label ?? 'your friend'
      : '';

  const peerTimelineEvents: TripEvent[] =
    timelineMode !== 'group' && timelineMode !== trip.id && sessionTripIds.includes(timelineMode)
      ? peerEvents.length > 0
        ? peerEvents
        : peerEventsFromGroupMerge
      : [];

  const displayEvents: TripEvent[] =
    timelineMode === 'group'
      ? groupTimelineEvents
      : timelineMode === trip.id
        ? myTripEvents
        : peerTimelineEvents;

  const displayTrip: Trip =
    timelineMode === 'group' || timelineMode === trip.id
      ? trip
      : peerTripForPeerMode ?? trip;

  const chipStyle = (active: boolean) => ({
    borderColor: active ? colors.primary : colors.border,
    backgroundColor: active ? colors.surfaceElevated : colors.surface,
  });
  const chipText = (active: boolean) => ({
    fontSize: FontSize.xs,
    fontWeight: '600' as const,
    color: active ? colors.primary : colors.textSecondary,
  });

  const myTripFishCount = totalFishFromEvents(myTripEvents);
  const groupFishCount = totalFishFromEvents(groupTimelineEvents);
  const peerFishFromMerged = (childTripId: string) => fishCountForSourceTrip(groupTimelineEvents, childTripId);

  const badgeShell = (active: boolean) => ({
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    backgroundColor: active ? `${colors.primary}33` : colors.borderLight,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  });
  const badgeLabel = (active: boolean) => ({
    fontSize: 10,
    fontWeight: '700' as const,
    color: active ? colors.primary : colors.textSecondary,
  });

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
      >
        <Pressable
          style={({ pressed }) => [styles.chip, chipStyle(timelineMode === 'group'), pressed && { opacity: 0.85 }]}
          onPress={() => setTimelineMode('group')}
        >
          <View style={styles.chipRowInner}>
            <Text style={chipText(timelineMode === 'group')}>Group</Text>
            <View style={badgeShell(timelineMode === 'group')}>
              <Text
                style={badgeLabel(timelineMode === 'group')}
                accessibilityLabel={`${groupFishCount} fish`}
              >
                {groupFishCount}
              </Text>
            </View>
          </View>
        </Pressable>
        {sessionTripTabOptions.map((p) => {
          const active = timelineMode === p.tripId;
          const fish =
            p.tripId === trip.id ? myTripFishCount : peerFishFromMerged(p.tripId);
          return (
            <Pressable
              key={p.tripId}
              style={({ pressed }) => [styles.chip, chipStyle(active), pressed && { opacity: 0.85 }]}
              onPress={() => setTimelineMode(p.tripId)}
            >
              <View style={styles.chipRowInner}>
                <Text style={[chipText(active), styles.chipLabelFlex]} numberOfLines={1}>
                  {p.label}
                </Text>
                <View style={badgeShell(active)}>
                  <Text style={badgeLabel(active)} accessibilityLabel={`${fish} fish`}>
                    {fish}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {offlineBlock ? (
        <View style={[styles.offlineBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.offlineTitle, { color: colors.text }]}>You&apos;re offline</Text>
          <Text style={[styles.offlineBody, { color: colors.textSecondary }]}>
            {timelineMode === 'group'
              ? 'The combined group timeline needs a connection. It will update after your trip syncs.'
              : `You’ll be able to see ${peerLabel}’s timeline after trips have synced when you’re back online.`}
          </Text>
        </View>
      ) : null}

      {!offlineBlock && timelineMode === 'group' && loadingRemote && groupTimelineEvents.length === 0 ? (
        <Text style={{ color: colors.textSecondary, padding: Spacing.md }}>Loading group timeline…</Text>
      ) : null}

      {!offlineBlock &&
      timelineMode !== trip.id &&
      timelineMode !== 'group' &&
      loadingRemote &&
      peerTimelineEvents.length === 0 ? (
        <Text style={{ color: colors.textSecondary, padding: Spacing.md }}>Loading…</Text>
      ) : null}

      {!offlineBlock &&
      timelineMode !== trip.id &&
      timelineMode !== 'group' &&
      sessionTripIds.includes(timelineMode) &&
      peerTimelineEvents.length === 0 &&
      peerFishFromMerged(timelineMode) === 0 ? (
        <Text style={[styles.peerEmptyHint, { color: colors.textSecondary }]}>
          {`Nothing on the shared timeline for ${peerLabel} yet. They may need to join the group with their live outing (People), or they have not logged catches on their trip.`}
        </Text>
      ) : null}

      {!offlineBlock ? (
        <JournalFishingTimeline
          trip={displayTrip}
          events={displayEvents}
          userId={userId}
          isConnected={isConnected}
          editMode={timelineMode === trip.id ? editMode : false}
          onEventsChange={timelineMode === trip.id ? onEventsChange : noopEvents}
          onTripPatch={timelineMode === trip.id ? onTripPatch : noopTripPatch}
          onCatchPhotoPress={onCatchPhotoPress}
          onRequestEditTripPin={timelineMode === trip.id ? onRequestEditTripPin : undefined}
          colorTokens={colors}
          eventSyncStatusForEvent={showTimelineSync ? eventSyncStatusForEvent : undefined}
          compactAttributionLabels={timelineMode === trip.id}
          attributionLabelForEvent={(ev) => {
            if (timelineMode === 'group') {
              return isTripEventWithSource(ev) ? ev.source_display_name : 'Angler';
            }
            if (timelineMode === trip.id) {
              if (isTripEventWithSource(ev) && ev.source_user_id !== trip.user_id) {
                return ev.source_display_name?.trim() || 'Angler';
              }
              return members.find((m) => m.user_id === trip.user_id)?.display_name ?? 'You';
            }
            const peerUid = sessionTripTabOptions.find((o) => o.tripId === timelineMode)?.userId;
            return (peerUid && members.find((m) => m.user_id === peerUid)?.display_name) ?? 'Angler';
          }}
          attributionAvatarUriForEvent={(ev) => {
            if (timelineMode === 'group') {
              return isTripEventWithSource(ev) ? avatarUriByUserId.get(ev.source_user_id) ?? null : null;
            }
            if (timelineMode === trip.id) {
              if (isTripEventWithSource(ev) && ev.source_user_id !== trip.user_id) {
                return avatarUriByUserId.get(ev.source_user_id) ?? null;
              }
              return avatarUriByUserId.get(trip.user_id) ?? null;
            }
            const peerUid = sessionTripTabOptions.find((o) => o.tripId === timelineMode)?.userId;
            return peerUid ? avatarUriByUserId.get(peerUid) ?? null : null;
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  /** Prevents chips from stretching tall when the timeline below uses flex:1. */
  chipScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 0,
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  chip: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 200,
  },
  chipRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  /** Peer name: avoid flex:1 + minWidth:0 here — in a horizontal ScrollView it collapses to width 0. */
  chipLabelFlex: {
    flexShrink: 1,
    maxWidth: 148,
  },
  offlineBanner: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  offlineTitle: { fontSize: FontSize.sm, fontWeight: '700', marginBottom: Spacing.xs },
  offlineBody: { fontSize: FontSize.sm, lineHeight: 20 },
  peerEmptyHint: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xs,
  },
});
