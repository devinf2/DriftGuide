import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { v4 as uuidv4 } from 'uuid';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { FLY_NAMES } from '@/src/constants/fishingTypes';
import { fetchFlies, fetchFlyCatalog, getFliesFromCache, loadFlyCatalogFromCache } from '@/src/services/flyService';
import { CatchDetailsModal } from '@/src/components/catch/CatchDetailsModal';
import {
  ChangeFlyPickerModal,
  mergeFlyPickerSelection,
  splitFlyChangeData,
} from '@/src/components/fly/ChangeFlyPickerModal';
import { BorderRadius, Colors, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import {
  deleteJournalTripEvent,
  fetchTripEvents,
  fetchTripsFromCloud,
  syncTripToCloud,
  updateTripTotalFishInCloud,
  upsertJournalTripEvent,
} from '@/src/services/sync';
import {
  coerceTripEventDataObject,
  findActiveFlyEventIdBefore,
  getTripEventDescription,
  sortEventsByTime,
  timestampBetween,
  totalFishFromEvents,
  upsertEventSorted,
} from '@/src/utils/journalTimeline';
import type { TripEndpointKind } from '@/src/components/journal/TripEndpointPinModal';
import type { AIQueryData, CatchData, Fly, FlyCatalog, FlyChangeData, NoteData, Trip, TripEvent } from '@/src/types';
import type { EventSyncStatus } from '@/src/types/sync';
import { TimelineCatchPhotoStrip } from '@/src/components/catch/TimelineCatchPhotoStrip';
import { formatEventTime } from '@/src/utils/formatters';
import { tripLifecycleNoteTimelineIcon } from '@/src/utils/timelineTripNoteIcon';

type RowAction = { label: string; destructive?: boolean; onPress: () => void };

const TIMELINE_EDIT_HELP =
  'Tap ⋮ on a row to edit, insert notes, fish, or fly changes, adjust start/end locations from Trip started or Trip ended, or delete.';

function formatCatchLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function CatchDetailsBlock({
  data,
  detailStyles,
}: {
  data: CatchData;
  detailStyles: { wrap: ViewStyle; line: TextStyle };
}) {
  const lines: string[] = [];
  if (data.note?.trim()) lines.push(data.note.trim());
  if (data.depth_ft != null) lines.push(`Depth: ${data.depth_ft} ft`);
  if (data.structure) lines.push(`Structure: ${formatCatchLabel(data.structure)}`);
  if (data.presentation_method) lines.push(`Presentation: ${formatCatchLabel(data.presentation_method)}`);
  if (data.released != null) lines.push(`Released: ${data.released ? 'Yes' : 'No'}`);
  if (lines.length === 0) return null;
  return (
    <View style={detailStyles.wrap}>
      {lines.map((line, i) => (
        <Text key={i} style={detailStyles.line}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const timelineSyncDotStyles = StyleSheet.create({
  col: { paddingTop: 4, width: 14, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

function labelForSyncStatus(s: EventSyncStatus): string {
  switch (s) {
    case 'synced':
      return 'Synced to cloud';
    case 'pending':
      return 'Waiting to upload';
    case 'syncing':
      return 'Uploading';
    case 'error':
      return 'Upload failed, will retry';
    default:
      return '';
  }
}

function TimelineSyncDot({ status, palette }: { status: EventSyncStatus; palette: ThemeColors }) {
  const color =
    status === 'error' ? palette.error : status === 'synced' ? palette.success : palette.warning;
  return (
    <View
      style={timelineSyncDotStyles.col}
      accessibilityRole="text"
      accessibilityLabel={labelForSyncStatus(status)}
    >
      <View style={[timelineSyncDotStyles.dot, { backgroundColor: color }]} />
    </View>
  );
}

export interface JournalFishingTimelineProps {
  trip: Trip;
  events: TripEvent[];
  userId: string;
  isConnected: boolean;
  editMode: boolean;
  onEventsChange: (events: TripEvent[]) => void;
  onTripPatch: (patch: Partial<Trip>) => void;
  onCatchPhotoPress?: (event: TripEvent) => void;
  /** Journal summary: open trip start/end pin editor */
  onRequestEditTripPin?: (kind: TripEndpointKind) => void;
  /** Group timeline: show a name label per row (e.g. angler attribution). */
  attributionLabelForEvent?: (event: TripEvent) => string | undefined;
  /** Group timeline: profile photo URL for the angler who recorded the event (initials if null). */
  attributionAvatarUriForEvent?: (event: TripEvent) => string | null | undefined;
  /**
   * When set with attribution callbacks, hides the per-row name line (avatar only).
   * Use for single-angler views (Me / peer) so rows stay compact.
   */
  compactAttributionLabels?: boolean;
  /** When embedded in a dark surface (e.g. active trip), pass `useAppTheme().colors` for readable text. */
  colorTokens?: ThemeColors;
  /** Cloud backup state per row (own-trip pending sync). Omit to hide the column. */
  eventSyncStatusForEvent?: (event: TripEvent) => EventSyncStatus;
}

export function JournalFishingTimeline({
  trip,
  events,
  userId,
  isConnected,
  editMode,
  onEventsChange,
  onTripPatch,
  onCatchPhotoPress,
  onRequestEditTripPin,
  attributionLabelForEvent,
  attributionAvatarUriForEvent,
  compactAttributionLabels = false,
  colorTokens,
  eventSyncStatusForEvent,
}: JournalFishingTimelineProps) {
  const palette = colorTokens ?? Colors;
  const styles = useMemo(() => createJournalFishingTimelineStyles(palette), [palette]);
  const catchDetailStyles = useMemo(
    () => ({ wrap: styles.timelineCatchDetails, line: styles.timelineCatchDetailLine }),
    [styles],
  );

  const sorted = useMemo(() => sortEventsByTime(events), [events]);
  const useRecorderColumn = attributionLabelForEvent != null;

  const [rowActions, setRowActions] = useState<{ event: TripEvent; index: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const [catchModal, setCatchModal] = useState<TripEvent | null>(null);
  const [noteModal, setNoteModal] = useState<TripEvent | null>(null);
  const [flyModal, setFlyModal] = useState<TripEvent | null>(null);
  const [aiModal, setAiModal] = useState<TripEvent | null>(null);
  const [timelineHelpVisible, setTimelineHelpVisible] = useState(false);
  const [userFlies, setUserFlies] = useState<Fly[]>([]);
  const [flyCatalog, setFlyCatalog] = useState<FlyCatalog[]>([]);

  const flyPickerNames = useMemo(
    () => (userFlies.length > 0 ? [...new Set(userFlies.map((f) => f.name))].sort() : FLY_NAMES),
    [userFlies],
  );

  useEffect(() => {
    if (!userId) return;
    if (isConnected) {
      fetchFlies(userId).then(setUserFlies).catch(() => setUserFlies([]));
    } else {
      void getFliesFromCache(userId).then(setUserFlies);
    }
  }, [userId, isConnected]);

  useEffect(() => {
    fetchFlyCatalog()
      .then(setFlyCatalog)
      .catch(async () => {
        setFlyCatalog(await loadFlyCatalogFromCache());
      });
  }, []);

  const reloadFromCloud = useCallback(async () => {
    // Peer / group rows use this Journal with `trip` = another angler's trip. Never merge that row or
    // their events into the signed-in user's active trip store (would make "You" show their log).
    if (trip.user_id !== userId) {
      return;
    }
    const trips = await fetchTripsFromCloud(userId);
    const found = trips.find((t) => t.id === trip.id);
    if (found && found.user_id === userId) {
      onTripPatch(found);
    }
    const ev = await fetchTripEvents(trip.id);
    const ownRows = ev.filter((e) => e.trip_id === trip.id);
    if (ownRows.length !== ev.length) {
      console.warn(
        `[Journal] fetchTripEvents returned ${ev.length - ownRows.length} rows for other trip_ids; dropped`,
      );
    }
    onEventsChange(ownRows);
  }, [trip.id, trip.user_id, userId, onEventsChange, onTripPatch]);

  const applyEventsAndTotals = useCallback(
    (next: TripEvent[]) => {
      if (trip.user_id !== userId) return;
      onEventsChange(next);
      onTripPatch({ total_fish: totalFishFromEvents(next) });
    },
    [trip.user_id, userId, onEventsChange, onTripPatch],
  );

  const submitJournalCatchEdit = useCallback(
    async (nextEvents: TripEvent[]) => {
      if (!isConnected) {
        Alert.alert('Offline', 'Connect to the internet to save changes.');
        throw new Error('offline');
      }
      const total_fish = totalFishFromEvents(nextEvents);
      const t = { ...trip, total_fish };
      applyEventsAndTotals(nextEvents);
      const ok = await syncTripToCloud(t, nextEvents);
      if (!ok) {
        await reloadFromCloud();
        throw new Error('save failed');
      }
    },
    [isConnected, trip, applyEventsAndTotals, reloadFromCloud],
  );

  const persist = useCallback(
    async (nextEvents: TripEvent[], touched: TripEvent, mode: 'upsert' | 'delete') => {
      if (!isConnected) {
        Alert.alert('Offline', 'Connect to the internet to edit your journal.');
        return false;
      }
      setSaving(true);
      try {
        if (mode === 'delete') {
          const ok = await deleteJournalTripEvent(trip.id, touched.id);
          if (!ok) throw new Error('delete failed');
        } else {
          const ok = await upsertJournalTripEvent(trip, touched, nextEvents);
          if (!ok) throw new Error('save failed');
        }
        const totalsOk = await updateTripTotalFishInCloud(trip, nextEvents);
        if (!totalsOk) throw new Error('totals failed');
        return true;
      } catch {
        Alert.alert('Could not save', 'Your changes were reverted. Try again.');
        await reloadFromCloud();
        return false;
      } finally {
        setSaving(false);
      }
    },
    [isConnected, trip, reloadFromCloud],
  );

  const openRowMenu = useCallback(
    (event: TripEvent, index: number) => {
      if (!editMode) return;
      setRowActions({ event, index });
    },
    [editMode],
  );

  const closeRowMenu = useCallback(() => setRowActions(null), []);

  const insertNote = useCallback(
    async (index: number, placement: 'above' | 'below') => {
      closeRowMenu();
      const ev = sorted[index];
      if (!ev) return;
      const prevTs = placement === 'above' ? (index > 0 ? sorted[index - 1].timestamp : null) : ev.timestamp;
      const nextTs =
        placement === 'above' ? ev.timestamp : index < sorted.length - 1 ? sorted[index + 1].timestamp : null;
      const ts =
        placement === 'above'
          ? timestampBetween(prevTs, nextTs, trip)
          : timestampBetween(prevTs, nextTs, trip);

      const newEvent: TripEvent = {
        id: uuidv4(),
        trip_id: trip.id,
        event_type: 'note',
        timestamp: ts,
        data: { text: '' } as NoteData,
        conditions_snapshot: null,
        latitude: null,
        longitude: null,
      };
      const next = upsertEventSorted(events, newEvent);
      applyEventsAndTotals(next);
      const ok = await persist(next, newEvent, 'upsert');
      if (ok) setNoteModal(newEvent);
    },
    [sorted, trip, events, applyEventsAndTotals, persist, closeRowMenu],
  );

  const insertFish = useCallback(
    async (index: number, placement: 'above' | 'below') => {
      closeRowMenu();
      const ev = sorted[index];
      if (!ev) return;
      const prevTs = placement === 'above' ? (index > 0 ? sorted[index - 1].timestamp : null) : ev.timestamp;
      const nextTs =
        placement === 'above' ? ev.timestamp : index < sorted.length - 1 ? sorted[index + 1].timestamp : null;
      const ts =
        placement === 'above'
          ? timestampBetween(prevTs, nextTs, trip)
          : timestampBetween(prevTs, nextTs, trip);

      const activeFly = findActiveFlyEventIdBefore(events, ts);
      const newEvent: TripEvent = {
        id: uuidv4(),
        trip_id: trip.id,
        event_type: 'catch',
        timestamp: ts,
        data: {
          species: null,
          size_inches: null,
          note: null,
          photo_url: null,
          active_fly_event_id: activeFly,
          caught_on_fly: 'primary',
          quantity: 1,
          depth_ft: null,
          presentation_method: null,
          released: null,
          structure: null,
        } as CatchData,
        conditions_snapshot: null,
        latitude: null,
        longitude: null,
      };
      const next = upsertEventSorted(events, newEvent);
      applyEventsAndTotals(next);
      const ok = await persist(next, newEvent, 'upsert');
      if (ok) setCatchModal(newEvent);
    },
    [sorted, trip, events, applyEventsAndTotals, persist, closeRowMenu],
  );

  const seedFlyChangeDataAtTimestamp = useCallback((allEvents: TripEvent[], timestampIso: string): FlyChangeData => {
    const priorId = findActiveFlyEventIdBefore(allEvents, timestampIso);
    if (!priorId) return { pattern: 'Unknown', size: null, color: null };
    const prior = allEvents.find((e) => e.id === priorId && e.event_type === 'fly_change');
    if (!prior) return { pattern: 'Unknown', size: null, color: null };
    const d = prior.data as FlyChangeData;
    return {
      pattern: d.pattern,
      size: d.size,
      color: d.color,
      fly_id: d.fly_id,
      fly_color_id: d.fly_color_id,
      fly_size_id: d.fly_size_id,
      ...(d.pattern2 != null && String(d.pattern2).trim()
        ? {
            pattern2: d.pattern2,
            size2: d.size2 ?? null,
            color2: d.color2 ?? null,
            fly_id2: d.fly_id2,
            fly_color_id2: d.fly_color_id2,
            fly_size_id2: d.fly_size_id2,
          }
        : {}),
    };
  }, []);

  const insertFlyChange = useCallback(
    async (index: number, placement: 'above' | 'below') => {
      closeRowMenu();
      const ev = sorted[index];
      if (!ev) return;
      const prevTs = placement === 'above' ? (index > 0 ? sorted[index - 1].timestamp : null) : ev.timestamp;
      const nextTs =
        placement === 'above' ? ev.timestamp : index < sorted.length - 1 ? sorted[index + 1].timestamp : null;
      const ts =
        placement === 'above'
          ? timestampBetween(prevTs, nextTs, trip)
          : timestampBetween(prevTs, nextTs, trip);

      const newEvent: TripEvent = {
        id: uuidv4(),
        trip_id: trip.id,
        event_type: 'fly_change',
        timestamp: ts,
        data: seedFlyChangeDataAtTimestamp(events, ts),
        conditions_snapshot: null,
        latitude: null,
        longitude: null,
      };
      const next = upsertEventSorted(events, newEvent);
      applyEventsAndTotals(next);
      const ok = await persist(next, newEvent, 'upsert');
      if (ok) setFlyModal(newEvent);
    },
    [sorted, trip, events, applyEventsAndTotals, persist, closeRowMenu, seedFlyChangeDataAtTimestamp],
  );

  const confirmDelete = useCallback(
    (event: TripEvent) => {
      closeRowMenu();
      Alert.alert('Remove entry?', 'This permanently removes this timeline row.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const next = events.filter((e) => e.id !== event.id);
            applyEventsAndTotals(next);
            await persist(next, event, 'delete');
          },
        },
      ]);
    },
    [events, applyEventsAndTotals, persist, closeRowMenu],
  );

  const flyChanges = events.filter((e) => e.event_type === 'fly_change');
  const uniqueFlies = [
    ...new Set(
      flyChanges.flatMap((e) => {
        const d = coerceTripEventDataObject(e);
        const p1 = typeof d.pattern === 'string' ? d.pattern : '';
        const p2 = typeof d.pattern2 === 'string' ? d.pattern2.trim() : '';
        return p2 ? [p1, p2].filter(Boolean) : [p1].filter(Boolean);
      }),
    ),
  ];

  const rowMenuActions: RowAction[] = useMemo(() => {
    if (!rowActions) return [];
    const { event, index } = rowActions;
    const actions: RowAction[] = [];

    if (event.event_type === 'catch') {
      actions.push({
        label: 'Edit fish…',
        onPress: () => {
          closeRowMenu();
          const fresh = events.find((e) => e.id === event.id && e.event_type === 'catch') ?? event;
          setCatchModal(fresh);
        },
      });
      actions.push({ label: 'Add note above', onPress: () => void insertNote(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNote(index, 'below') });
      actions.push({ label: 'Add fish above', onPress: () => void insertFish(index, 'above') });
      actions.push({ label: 'Add fish below', onPress: () => void insertFish(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChange(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChange(index, 'below') });
    } else if (event.event_type === 'note') {
      const noteText = (event.data as NoteData).text;
      if (onRequestEditTripPin) {
        if (noteText === 'Trip started') {
          actions.push({
            label: 'Adjust start location…',
            onPress: () => {
              closeRowMenu();
              onRequestEditTripPin('start');
            },
          });
        } else if (typeof noteText === 'string' && noteText.startsWith('Trip ended')) {
          actions.push({
            label: 'Adjust end location…',
            onPress: () => {
              closeRowMenu();
              onRequestEditTripPin('end');
            },
          });
        }
      }
      actions.push({ label: 'Edit note…', onPress: () => { closeRowMenu(); setNoteModal(event); } });
      actions.push({ label: 'Add note above', onPress: () => void insertNote(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNote(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChange(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChange(index, 'below') });
    } else if (event.event_type === 'fly_change') {
      actions.push({ label: 'Edit fly change…', onPress: () => { closeRowMenu(); setFlyModal(event); } });
      actions.push({ label: 'Add note above', onPress: () => void insertNote(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNote(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChange(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChange(index, 'below') });
    } else if (event.event_type === 'ai_query') {
      actions.push({ label: 'Edit AI entry…', onPress: () => { closeRowMenu(); setAiModal(event); } });
      actions.push({ label: 'Add note above', onPress: () => void insertNote(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNote(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChange(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChange(index, 'below') });
    } else {
      actions.push({ label: 'Add note above', onPress: () => void insertNote(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNote(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChange(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChange(index, 'below') });
    }

    actions.push({
      label: 'Delete',
      destructive: true,
      onPress: () => confirmDelete(event),
    });
    return actions;
  }, [rowActions, events, closeRowMenu, insertNote, insertFish, insertFlyChange, confirmDelete, onRequestEditTripPin]);

  return (
    <View style={styles.root}>
      <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabContentInner}>
        {trip.status === 'completed' && uniqueFlies.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Flies Used</Text>
            <View style={styles.flyChips}>
              {uniqueFlies.map((fly, i) => (
                <View key={i} style={styles.flyChip}>
                  <Text style={styles.flyChipText}>{fly}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.timelineSectionHeader}>
            <Text style={styles.sectionTitle}>Timeline</Text>
            {editMode ? (
              <Pressable
                onPress={() => setTimelineHelpVisible(true)}
                hitSlop={12}
                style={styles.timelineHelpIconHit}
                accessibilityRole="button"
                accessibilityLabel="Timeline editing help"
              >
                <MaterialIcons name="info-outline" size={20} color={palette.text} />
              </Pressable>
            ) : null}
          </View>
          {sorted.length === 0 ? (
            <Text style={styles.emptyHint}>No events recorded for this trip.</Text>
          ) : (
            sorted.map((event, index) => {
              const noteTextForIcon =
                event.event_type === 'note'
                  ? (() => {
                      const o = coerceTripEventDataObject(event);
                      return typeof o.text === 'string' ? o.text : '';
                    })()
                  : '';
              const lifecycleIcon =
                event.event_type === 'note'
                  ? tripLifecycleNoteTimelineIcon(noteTextForIcon, palette)
                  : null;
              const recorderLabel = useRecorderColumn
                ? (attributionLabelForEvent?.(event)?.trim() || 'Angler')
                : '';
              const attributionUri = useRecorderColumn
                ? attributionAvatarUriForEvent?.(event)?.trim() || null
                : null;
              const attributionInitial =
                recorderLabel.length > 0 ? recorderLabel.charAt(0).toUpperCase() : '?';
              // Match recorderLabel fallback so a missing/blank callback string does not hide the name row while an avatar still shows.
              const showNameLine =
                useRecorderColumn && !compactAttributionLabels && recorderLabel.length > 0;

              return (
                <View key={event.id} style={styles.timelineItem}>
                  <Text style={styles.timelineTime}>{formatEventTime(event.timestamp)}</Text>
                  {useRecorderColumn ? (
                    <View style={styles.timelineAttributionAvatarCol}>
                      {attributionUri ? (
                        <Image
                          source={{ uri: attributionUri }}
                          style={styles.timelineAttributionAvatar}
                          contentFit="cover"
                          accessibilityIgnoresInvertColors
                        />
                      ) : (
                        <View
                          style={[
                            styles.timelineAttributionAvatar,
                            styles.timelineAttributionAvatarPlaceholder,
                          ]}
                        >
                          <Text style={styles.timelineAttributionAvatarLetter}>{attributionInitial}</Text>
                        </View>
                      )}
                    </View>
                  ) : null}
                  <View style={styles.timelineContent}>
                    <View style={styles.timelineDot}>
                      {event.event_type === 'catch' ? (
                        <MaterialCommunityIcons name="fish" size={14} color={palette.primaryLight} />
                      ) : event.event_type === 'fly_change' ? (
                        <MaterialCommunityIcons name="hook" size={14} color={palette.secondaryLight} />
                      ) : event.event_type === 'ai_query' ? (
                        <MaterialIcons name="smart-toy" size={14} color={palette.info} />
                      ) : lifecycleIcon ? (
                        <MaterialIcons name={lifecycleIcon.name} size={14} color={lifecycleIcon.color} />
                      ) : (
                        <MaterialIcons name="edit-note" size={14} color={palette.textSecondary} />
                      )}
                    </View>
                    <View style={styles.timelineTextBlock}>
                      {showNameLine ? (
                        <Text style={styles.timelineAttribution}>{recorderLabel}</Text>
                      ) : null}
                      <Text style={styles.timelineText}>{getTripEventDescription(event)}</Text>
                      {event.event_type === 'catch' ? (
                        <CatchDetailsBlock data={event.data as CatchData} detailStyles={catchDetailStyles} />
                      ) : null}
                      {event.event_type === 'catch' ? (
                        <TimelineCatchPhotoStrip
                          data={event.data as CatchData}
                          onPress={() => onCatchPhotoPress?.(event)}
                          imageStyle={styles.timelineCatchThumb}
                        />
                      ) : null}
                    </View>
                    {eventSyncStatusForEvent ? (
                      <TimelineSyncDot status={eventSyncStatusForEvent(event)} palette={palette} />
                    ) : null}
                    {editMode ? (
                      <Pressable
                        style={styles.rowMenuBtn}
                        onPress={() => openRowMenu(event, index)}
                        hitSlop={12}
                        disabled={saving}
                      >
                        <MaterialIcons name="more-vert" size={22} color={palette.textSecondary} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <Modal
        visible={timelineHelpVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTimelineHelpVisible(false)}
      >
        <View style={styles.timelineHelpOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setTimelineHelpVisible(false)}
            accessibilityLabel="Dismiss help"
          />
          <View style={styles.timelineHelpCard}>
            <Text style={styles.timelineHelpTitle}>Editing the timeline</Text>
            <Text style={styles.timelineHelpBody}>{TIMELINE_EDIT_HELP}</Text>
            <Pressable
              style={styles.timelineHelpDismiss}
              onPress={() => setTimelineHelpVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Got it"
            >
              <Text style={styles.timelineHelpDismissText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={rowActions != null} transparent animationType="fade" onRequestClose={closeRowMenu}>
        <View style={styles.actionOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeRowMenu} />
          <View style={styles.actionSheet}>
            {rowMenuActions.map((a) => (
              <Pressable
                key={a.label}
                style={styles.actionRow}
                onPress={() => {
                  a.onPress();
                }}
              >
                <Text style={[styles.actionLabel, a.destructive && styles.actionLabelDestructive]}>
                  {a.label}
                </Text>
              </Pressable>
            ))}
            <Pressable style={styles.actionRow} onPress={closeRowMenu}>
              <Text style={styles.actionCancel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {saving ? (
        <View style={styles.savingOverlay} pointerEvents="none">
          <ActivityIndicator color={palette.primaryLight} />
        </View>
      ) : null}

      <CatchDetailsModal
        visible={catchModal != null}
        onClose={() => setCatchModal(null)}
        mode="edit"
        trip={trip}
        userId={userId}
        isConnected={isConnected}
        userFlies={userFlies}
        flyPickerNames={flyPickerNames}
        flyCatalog={flyCatalog}
        allEvents={events}
        editingEvent={catchModal}
        onSubmitEdit={submitJournalCatchEdit}
      />
      <EditNoteModal
        visible={noteModal != null}
        event={noteModal}
        allEvents={events}
        styles={styles}
        themeColors={palette}
        onClose={() => setNoteModal(null)}
        onSaved={(updated, nextEvents) => {
          applyEventsAndTotals(nextEvents);
          void persist(nextEvents, updated, 'upsert');
          setNoteModal(null);
        }}
      />
      <ChangeFlyPickerModal
        visible={flyModal != null}
        onClose={() => setFlyModal(null)}
        userFlies={userFlies}
        flyCatalog={flyCatalog}
        seedKey={flyModal?.id ?? ''}
        initialPrimary={flyModal ? splitFlyChangeData(flyModal.data as FlyChangeData).primary : null}
        initialDropper={flyModal ? splitFlyChangeData(flyModal.data as FlyChangeData).dropper : null}
        title="Edit fly change"
        onConfirm={(primary, dropper) => {
          if (!flyModal) return;
          const data = mergeFlyPickerSelection(primary, dropper);
          const updated: TripEvent = { ...flyModal, data };
          const nextEvents = upsertEventSorted(events, updated);
          applyEventsAndTotals(nextEvents);
          void persist(nextEvents, updated, 'upsert');
          setFlyModal(null);
        }}
      />
      <EditAiModal
        visible={aiModal != null}
        event={aiModal}
        allEvents={events}
        styles={styles}
        onClose={() => setAiModal(null)}
        onSaved={(updated, nextEvents) => {
          applyEventsAndTotals(nextEvents);
          void persist(nextEvents, updated, 'upsert');
          setAiModal(null);
        }}
      />
    </View>
  );
}

function createJournalFishingTimelineStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1 },
    tabContent: { flex: 1 },
    tabContentInner: { padding: Spacing.lg, gap: Spacing.md },
    section: { gap: Spacing.sm },
    sectionTitle: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: c.text,
      textTransform: 'uppercase',
      letterSpacing: 1,
      opacity: 0.85,
    },
    timelineSectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    timelineHelpIconHit: { padding: 2 },
    timelineHelpOverlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    timelineHelpCard: {
      backgroundColor: c.surfaceElevated,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      maxWidth: 360,
      width: '100%',
      borderWidth: 1,
      borderColor: c.border,
    },
    timelineHelpTitle: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: c.text,
      marginBottom: Spacing.sm,
    },
    timelineHelpBody: { fontSize: FontSize.sm, color: c.text, lineHeight: 22 },
    timelineHelpDismiss: {
      marginTop: Spacing.md,
      alignSelf: 'flex-end',
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
    },
    timelineHelpDismissText: { fontSize: FontSize.sm, fontWeight: '600', color: c.primaryLight },
    emptyHint: { fontSize: FontSize.sm, color: c.text, textAlign: 'center', opacity: 0.75 },
    flyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    flyChip: {
      backgroundColor: c.surfaceElevated,
      borderRadius: BorderRadius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderWidth: 1,
      borderColor: c.border,
    },
    flyChipText: { fontSize: FontSize.sm, fontWeight: '500', color: c.text },
    timelineItem: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', alignSelf: 'stretch' },
    timelineTime: { fontSize: FontSize.xs, color: c.text, width: 65, paddingTop: 2, opacity: 0.75 },
    timelineAttributionAvatarCol: { paddingTop: 2 },
    timelineAttributionAvatar: {
      width: 28,
      height: 28,
      borderRadius: BorderRadius.full,
      backgroundColor: c.borderLight,
      overflow: 'hidden',
    },
    timelineAttributionAvatarPlaceholder: {
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    timelineAttributionAvatarLetter: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textInverse,
    },
    timelineContent: { flex: 1, minWidth: 0, flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
    timelineDot: { width: 20, alignItems: 'center', paddingTop: 2 },
    timelineTextBlock: { flex: 1, minWidth: 0, flexShrink: 1, gap: Spacing.sm },
    timelineAttribution: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: c.text,
      marginBottom: -Spacing.xs,
      opacity: 0.9,
    },
    timelineText: { fontSize: FontSize.sm, color: c.text, fontWeight: '500' },
    timelineCatchThumb: { width: 72, height: 72, borderRadius: BorderRadius.sm, backgroundColor: c.surfaceElevated },
    timelineCatchDetails: { marginTop: Spacing.xs, gap: 2 },
    timelineCatchDetailLine: { fontSize: FontSize.xs, color: c.text, opacity: 0.85 },
    rowMenuBtn: { padding: Spacing.xs },
    actionOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
    actionSheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      paddingBottom: Spacing.xl,
    },
    actionRow: {
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    actionLabel: { fontSize: FontSize.md, color: c.text },
    actionLabelDestructive: { color: c.error },
    actionCancel: { fontSize: FontSize.md, fontWeight: '600', color: c.primaryLight, textAlign: 'center' },
    savingOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.25)',
    },
    modalRoot: { flex: 1, backgroundColor: c.background },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    modalTitle: { fontSize: FontSize.md, fontWeight: '700', color: c.text },
    modalCancel: { fontSize: FontSize.md, color: c.textSecondary },
    modalSave: { fontSize: FontSize.md, fontWeight: '600', color: c.primaryLight },
    modalScroll: { flex: 1, padding: Spacing.lg },
    fieldLabel: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: c.textSecondary,
      marginBottom: Spacing.xs,
      marginTop: Spacing.sm,
    },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      fontSize: FontSize.md,
      color: c.text,
      backgroundColor: c.surface,
    },
    tallInput: { minHeight: 80, textAlignVertical: 'top' },
    noteBody: {
      flex: 1,
      margin: Spacing.lg,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      fontSize: FontSize.md,
      color: c.text,
      textAlignVertical: 'top',
    },
  });
}

function EditNoteModal({
  visible,
  event,
  allEvents,
  styles,
  themeColors,
  onClose,
  onSaved,
}: {
  visible: boolean;
  event: TripEvent | null;
  allEvents: TripEvent[];
  styles: ReturnType<typeof createJournalFishingTimelineStyles>;
  themeColors: ThemeColors;
  onClose: () => void;
  onSaved: (e: TripEvent, all: TripEvent[]) => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (event) setText((event.data as NoteData).text ?? '');
  }, [event?.id]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Note</Text>
          <Pressable
            onPress={() => {
              if (!event) return;
              const next: TripEvent = {
                ...event,
                data: { text: text.trim() || 'Note' } as NoteData,
              };
              onSaved(next, upsertEventSorted(allEvents, next));
            }}
          >
            <Text style={styles.modalSave}>Save</Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.noteBody}
          value={text}
          onChangeText={setText}
          placeholder="Write a note…"
          placeholderTextColor={themeColors.textTertiary}
          multiline
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function EditAiModal({
  visible,
  event,
  allEvents,
  styles,
  onClose,
  onSaved,
}: {
  visible: boolean;
  event: TripEvent | null;
  allEvents: TripEvent[];
  styles: ReturnType<typeof createJournalFishingTimelineStyles>;
  onClose: () => void;
  onSaved: (e: TripEvent, all: TripEvent[]) => void;
}) {
  const [q, setQ] = useState('');
  const [r, setR] = useState('');

  useEffect(() => {
    if (!event) return;
    const d = event.data as AIQueryData;
    setQ(d.question ?? '');
    setR(d.response ?? '');
  }, [event?.id]);

  if (!event) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose}>
            <Text style={styles.modalCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>AI entry</Text>
          <Pressable
            onPress={() => {
              const prev = event.data as AIQueryData;
              const next: TripEvent = {
                ...event,
                data: {
                  ...prev,
                  question: q.trim() || 'Question',
                  response: r.trim() || null,
                },
              };
              onSaved(next, upsertEventSorted(allEvents, next));
            }}
          >
            <Text style={styles.modalSave}>Save</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Question</Text>
          <TextInput style={styles.input} value={q} onChangeText={setQ} multiline />
          <Text style={styles.fieldLabel}>Response</Text>
          <TextInput style={[styles.input, styles.tallInput]} value={r} onChangeText={setR} multiline />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
