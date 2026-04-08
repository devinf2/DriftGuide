import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { JournalFishingTimeline } from '@/src/components/journal/JournalFishingTimeline';
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { fetchTripEvents } from '@/src/services/sync';
import {
  fetchMergedSessionEvents,
  findTripForUserInSession,
  listSessionMembers,
} from '@/src/services/sharedSessionService';
import { fetchProfile } from '@/src/services/friendsService';
import type { TripEndpointKind } from '@/src/components/journal/TripEndpointPinModal';
import type { Trip, TripEvent, TripEventWithSource } from '@/src/types';

type TimelineMode = 'group' | 'me' | string;

function isTripEventWithSource(e: TripEvent): e is TripEventWithSource {
  return 'source_display_name' in e && typeof (e as TripEventWithSource).source_display_name === 'string';
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

  const [members, setMembers] = useState<{ user_id: string; display_name: string }[]>([]);
  const [peerUserIds, setPeerUserIds] = useState<string[]>([]);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('me');
  const [groupEvents, setGroupEvents] = useState<TripEventWithSource[]>([]);
  const [peerEvents, setPeerEvents] = useState<TripEvent[]>([]);
  const [peerTripForPeerMode, setPeerTripForPeerMode] = useState<Trip | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);

  const noopEvents = useCallback(() => {}, []);
  const noopTripPatch = useCallback(() => {}, []);

  const loadMembers = useCallback(async () => {
    if (!sessionId || !isConnected) {
      setMembers([]);
      setPeerUserIds([]);
      return;
    }
    const raw = await listSessionMembers(sessionId);
    const others = raw.map((m) => m.user_id).filter((id) => id !== userId);
    setPeerUserIds(others);
    const enriched: { user_id: string; display_name: string }[] = [];
    for (const m of raw) {
      const p = await fetchProfile(m.user_id);
      enriched.push({
        user_id: m.user_id,
        display_name: p?.display_name?.trim() || 'Angler',
      });
    }
    setMembers(enriched);
  }, [sessionId, userId, isConnected]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const peerOptions = useMemo(() => {
    return peerUserIds.map((pid) => {
      const m = members.find((x) => x.user_id === pid);
      return { userId: pid, label: m?.display_name ?? 'Angler' };
    });
  }, [peerUserIds, members]);

  const loadGroup = useCallback(async () => {
    if (!sessionId || !isConnected) return;
    setLoadingRemote(true);
    try {
      const merged = await fetchMergedSessionEvents(sessionId);
      setGroupEvents(merged);
    } finally {
      setLoadingRemote(false);
    }
  }, [sessionId, isConnected]);

  const loadPeer = useCallback(
    async (peerId: string) => {
      if (!sessionId || !isConnected) return;
      setLoadingRemote(true);
      try {
        const peerTrip = await findTripForUserInSession(sessionId, peerId);
        setPeerTripForPeerMode(peerTrip);
        if (peerTrip) {
          const ev = await fetchTripEvents(peerTrip.id);
          setPeerEvents(ev);
        } else {
          setPeerEvents([]);
        }
      } finally {
        setLoadingRemote(false);
      }
    },
    [sessionId, isConnected],
  );

  useEffect(() => {
    if (!sessionId || !isConnected) return;
    if (timelineMode === 'group') {
      void loadGroup();
    } else if (timelineMode !== 'me' && peerUserIds.includes(timelineMode)) {
      void loadPeer(timelineMode);
    }
  }, [sessionId, isConnected, timelineMode, loadGroup, loadPeer, peerUserIds]);

  useEffect(() => {
    if (!sessionId || !isConnected || timelineMode !== 'group') return;
    const t = setInterval(() => void loadGroup(), groupPollMs);
    return () => clearInterval(t);
  }, [sessionId, isConnected, timelineMode, loadGroup, groupPollMs]);

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
      />
    );
  }

  const offlineBlock = !isConnected && (timelineMode === 'group' || timelineMode !== 'me');
  const peerLabel =
    timelineMode !== 'me' && timelineMode !== 'group'
      ? peerOptions.find((p) => p.userId === timelineMode)?.label ?? 'your friend'
      : '';

  const displayEvents: TripEvent[] =
    timelineMode === 'group'
      ? groupEvents
      : timelineMode === 'me'
        ? events
        : peerEvents;

  const displayTrip: Trip =
    timelineMode === 'me'
      ? trip
      : timelineMode === 'group'
        ? trip
        : peerTripForPeerMode ?? trip;

  const chipStyle = (active: boolean) => [
    styles.chip,
    {
      borderColor: active ? colors.primary : colors.border,
      backgroundColor: active ? colors.surfaceElevated : colors.surface,
    },
  ];
  const chipText = (active: boolean) => ({
    fontSize: FontSize.sm,
    fontWeight: '600' as const,
    color: active ? colors.primary : colors.textSecondary,
  });

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        <Pressable style={chipStyle(timelineMode === 'group')} onPress={() => setTimelineMode('group')}>
          <Text style={chipText(timelineMode === 'group')}>Group</Text>
        </Pressable>
        <Pressable style={chipStyle(timelineMode === 'me')} onPress={() => setTimelineMode('me')}>
          <Text style={chipText(timelineMode === 'me')}>Me</Text>
        </Pressable>
        {peerOptions.map((p) => (
          <Pressable
            key={p.userId}
            style={chipStyle(timelineMode === p.userId)}
            onPress={() => setTimelineMode(p.userId)}
          >
            <Text style={chipText(timelineMode === p.userId)} numberOfLines={1}>
              {p.label}
            </Text>
          </Pressable>
        ))}
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

      {!offlineBlock && timelineMode === 'group' && loadingRemote && groupEvents.length === 0 ? (
        <Text style={{ color: colors.textSecondary, padding: Spacing.md }}>Loading group timeline…</Text>
      ) : null}

      {!offlineBlock && timelineMode !== 'me' && timelineMode !== 'group' && loadingRemote && peerEvents.length === 0 ? (
        <Text style={{ color: colors.textSecondary, padding: Spacing.md }}>Loading…</Text>
      ) : null}

      {!offlineBlock ? (
        <JournalFishingTimeline
          trip={displayTrip}
          events={displayEvents}
          userId={userId}
          isConnected={isConnected}
          editMode={timelineMode === 'me' ? editMode : false}
          onEventsChange={timelineMode === 'me' ? onEventsChange : noopEvents}
          onTripPatch={timelineMode === 'me' ? onTripPatch : noopTripPatch}
          onCatchPhotoPress={onCatchPhotoPress}
          onRequestEditTripPin={timelineMode === 'me' ? onRequestEditTripPin : undefined}
          attributionLabelForEvent={
            timelineMode === 'group'
              ? (ev) => (isTripEventWithSource(ev) ? ev.source_display_name : undefined)
              : undefined
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
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
});
