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
} from 'react-native';
import { Image } from 'expo-image';
import { v4 as uuidv4 } from 'uuid';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { FLY_NAMES } from '@/src/constants/fishingTypes';
import { fetchFliesOrCache, getFlyCatalogOrBundled } from '@/src/services/flyService';
import { CatchDetailsModal } from '@/src/components/catch/CatchDetailsModal';
import {
  ChangeFlyPickerModal,
  mergeFlyPickerSelection,
  splitFlyChangeData,
} from '@/src/components/fly/ChangeFlyPickerModal';
import { FlyChangeViewModal } from '@/src/components/fly/FlyChangeViewModal';
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
  buildTimelineDisplayRows,
  createBlankCatchEvent,
  findActiveFlyEventIdBefore,
  getTripEventDescription,
  sortEventsByTime,
  timestampBetween,
  totalFishFromEvents,
  upsertEventSorted,
} from '@/src/utils/journalTimeline';
import type { TripEndpointKind } from '@/src/components/journal/TripEndpointPinModal';
import type { AIQueryData, CatchData, Fly, FlyCatalog, FlyChangeData, NoteData, Photo, Trip, TripEvent } from '@/src/types';
import type { EventSyncStatus } from '@/src/types/sync';
import { TripDashboardTimelineRows } from '@/src/components/trip/TripDashboardTimelineRows';
import {
  createTripDashboardTimelineTitleStyles,
} from '@/src/components/trip/tripDashboardTimelineStyles';
import { buildAlbumPhotoUrlsByCatchId } from '@/src/utils/catchPhotos';
import { getTripFliesWithPhotos, formatFlySizeColorDetail } from '@/src/utils/getTripFliesWithPhotos';
import {
  resolveFlyImageSourceFromPhotoUrl,
} from '@/src/utils/resolveFlyPhotoUrl';
import { displayFlyName } from '@/src/utils/flyValidation';

type RowAction = { label: string; destructive?: boolean; onPress: () => void };

const TIMELINE_EDIT_HELP =
  'Tap ⋮ on a row to edit, insert notes, fish, or fly changes, adjust start/end locations from Trip started or Trip ended, or delete. Catch rows expand for details when tapped.';

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
  /** Trip album rows — same fetch as Photos tab; timeline thumbs prefer these URLs. */
  tripAlbumPhotos?: Photo[];
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
  tripAlbumPhotos = [],
}: JournalFishingTimelineProps) {
  const palette = colorTokens ?? Colors;
  const useDashboardTimeline = colorTokens != null;
  const styles = useMemo(() => createJournalFishingTimelineStyles(palette), [palette]);
  const dashboardScrollStyles = useMemo(
    () => createTripDashboardTimelineTitleStyles(palette),
    [palette],
  );
  const dashboardTimelineTitleStyles = dashboardScrollStyles;
  const albumPhotoUrlsByCatchId = useMemo(
    () => buildAlbumPhotoUrlsByCatchId(tripAlbumPhotos),
    [tripAlbumPhotos],
  );

  const sorted = useMemo(() => sortEventsByTime(events), [events]);
  const timelineDisplayRows = useMemo(
    () => buildTimelineDisplayRows(sorted, { newestFirst: useDashboardTimeline }),
    [sorted, useDashboardTimeline],
  );

  const [rowActions, setRowActions] = useState<{ event: TripEvent; index: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const [catchModal, setCatchModal] = useState<TripEvent | null>(null);
  const [noteModal, setNoteModal] = useState<TripEvent | null>(null);
  const [flyModal, setFlyModal] = useState<TripEvent | null>(null);
  const [flyViewEvent, setFlyViewEvent] = useState<TripEvent | null>(null);
  const [expandedCatchIds, setExpandedCatchIds] = useState<Set<string>>(() => new Set());
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
    void fetchFliesOrCache(userId).then(setUserFlies);
  }, [userId, isConnected]);

  useEffect(() => {
    void getFlyCatalogOrBundled().then(setFlyCatalog);
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

  const toggleCatchExpanded = useCallback((eventId: string) => {
    setExpandedCatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }, []);

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

      const newEvent = createBlankCatchEvent(trip.id, ts, events);
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

  const tripFliesWithPhotos = useMemo(
    () => getTripFliesWithPhotos(events, userFlies, flyCatalog),
    [events, userFlies, flyCatalog],
  );

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
      actions.push({ label: 'Add catch above', onPress: () => void insertFish(index, 'above') });
      actions.push({ label: 'Add catch below', onPress: () => void insertFish(index, 'below') });
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
      actions.push({ label: 'Add catch above', onPress: () => void insertFish(index, 'above') });
      actions.push({ label: 'Add catch below', onPress: () => void insertFish(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChange(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChange(index, 'below') });
    } else if (event.event_type === 'fly_change') {
      actions.push({ label: 'Edit fly change…', onPress: () => { closeRowMenu(); setFlyModal(event); } });
      actions.push({ label: 'Add note above', onPress: () => void insertNote(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNote(index, 'below') });
      actions.push({ label: 'Add catch above', onPress: () => void insertFish(index, 'above') });
      actions.push({ label: 'Add catch below', onPress: () => void insertFish(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChange(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChange(index, 'below') });
    } else if (event.event_type === 'ai_query') {
      actions.push({ label: 'Edit AI entry…', onPress: () => { closeRowMenu(); setAiModal(event); } });
      actions.push({ label: 'Add note above', onPress: () => void insertNote(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNote(index, 'below') });
      actions.push({ label: 'Add catch above', onPress: () => void insertFish(index, 'above') });
      actions.push({ label: 'Add catch below', onPress: () => void insertFish(index, 'below') });
      actions.push({ label: 'Add fly change above', onPress: () => void insertFlyChange(index, 'above') });
      actions.push({ label: 'Add fly change below', onPress: () => void insertFlyChange(index, 'below') });
    } else {
      actions.push({ label: 'Add note above', onPress: () => void insertNote(index, 'above') });
      actions.push({ label: 'Add note below', onPress: () => void insertNote(index, 'below') });
      actions.push({ label: 'Add catch above', onPress: () => void insertFish(index, 'above') });
      actions.push({ label: 'Add catch below', onPress: () => void insertFish(index, 'below') });
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
      <ScrollView
        style={styles.tabContent}
        contentContainerStyle={
          useDashboardTimeline ? styles.dashboardTimelineOuter : styles.tabContentInner
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        {trip.status === 'completed' && tripFliesWithPhotos.length > 0 ? (
          <View style={useDashboardTimeline ? styles.dashboardFlySection : styles.section}>
            <Text style={styles.sectionTitle}>Flies Used</Text>
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.flyChipsScroll}
            >
              {tripFliesWithPhotos.map((fly) => {
                const imageSource = resolveFlyImageSourceFromPhotoUrl(fly.pattern, fly.photoUrl);
                const sizeColor = formatFlySizeColorDetail(fly.size, fly.color);
                return (
                  <View key={fly.key} style={styles.flyChip}>
                    {imageSource ? (
                      <Image source={imageSource} style={styles.flyChipImage} resizeMode="contain" />
                    ) : (
                      <View style={styles.flyChipImagePlaceholder}>
                        <MaterialCommunityIcons name="hook" size={14} color={palette.textTertiary} />
                      </View>
                    )}
                    <View style={styles.flyChipTextCol}>
                      <Text style={styles.flyChipText} numberOfLines={2}>
                        {displayFlyName(fly.pattern)}
                      </Text>
                      {sizeColor ? (
                        <Text style={styles.flyChipDetail} numberOfLines={1}>
                          {sizeColor}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        <View style={useDashboardTimeline ? styles.dashboardTimelineBlock : styles.section}>
          <View style={styles.timelineSectionHeader}>
            <Text
              style={
                useDashboardTimeline
                  ? dashboardTimelineTitleStyles.timelineTitle
                  : styles.sectionTitle
              }
            >
              Timeline
            </Text>
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
            <TripDashboardTimelineRows
              rows={timelineDisplayRows}
              colors={palette}
              userFlies={userFlies}
              flyCatalog={flyCatalog}
              albumPhotoUrlsByCatchId={albumPhotoUrlsByCatchId}
              expandedCatchIds={expandedCatchIds}
              onToggleCatchExpanded={toggleCatchExpanded}
              onCatchPhotoPress={onCatchPhotoPress}
              onCatchEditPress={editMode ? (ev) => setCatchModal(ev) : undefined}
              onFlyViewPress={setFlyViewEvent}
              onRowMenuPress={(event, index) => openRowMenu(event, index)}
              showRowMenu={editMode}
              attributionLabelForEvent={attributionLabelForEvent}
              attributionAvatarUriForEvent={attributionAvatarUriForEvent}
              compactAttributionLabels={compactAttributionLabels}
              eventSyncStatusForEvent={eventSyncStatusForEvent}
            />
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
      <FlyChangeViewModal
        visible={flyViewEvent != null}
        onClose={() => setFlyViewEvent(null)}
        data={flyViewEvent ? (flyViewEvent.data as FlyChangeData) : null}
        userFlies={userFlies}
        flyCatalog={flyCatalog}
        onEdit={
          editMode && flyViewEvent
            ? () => {
                const ev = flyViewEvent;
                setFlyViewEvent(null);
                setFlyModal(ev);
              }
            : undefined
        }
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
        userId={userId}
        isConnected={isConnected}
        tripId={trip.id}
        onUserFliesUpdated={setUserFlies}
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
    dashboardTimelineOuter: {
      flexGrow: 1,
      paddingBottom: Spacing.lg,
    },
    dashboardFlySection: {
      gap: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.lg,
    },
    dashboardTimelineBlock: {
      flex: 1,
      paddingHorizontal: Spacing.lg,
      marginTop: Spacing.sm,
    },
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
    flyChipsScroll: { gap: Spacing.sm, paddingVertical: Spacing.xs },
    flyChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: c.surfaceElevated,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderWidth: 1,
      borderColor: c.border,
      maxWidth: 200,
    },
    flyChipImage: {
      width: 28,
      height: 28,
      borderRadius: BorderRadius.sm,
      backgroundColor: c.background,
    },
    flyChipImagePlaceholder: {
      width: 28,
      height: 28,
      borderRadius: BorderRadius.sm,
      backgroundColor: c.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    flyChipTextCol: { flexShrink: 1, minWidth: 0, gap: 2 },
    flyChipText: { fontSize: FontSize.sm, fontWeight: '500', color: c.text },
    flyChipDetail: { fontSize: FontSize.xs, color: c.textSecondary },
    timelineFlyThumb: {
      width: 22,
      height: 22,
      borderRadius: 4,
      backgroundColor: c.background,
    },
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
    timelineFlyPressable: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      gap: Spacing.sm,
      alignItems: 'flex-start',
    },
    timelineDot: { width: 20, alignItems: 'center', paddingTop: 2 },
    timelineDotCatchPhoto: { width: 24, overflow: 'hidden' },
    timelineCatchNodeImage: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: c.surfaceElevated,
    },
    timelineTextBlock: { flex: 1, minWidth: 0, flexShrink: 1, gap: Spacing.sm },
    timelineAttribution: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: c.text,
      marginBottom: -Spacing.xs,
      opacity: 0.9,
    },
    timelineText: { fontSize: FontSize.sm, color: c.text, fontWeight: '500' },
    timelineCatchDetails: { marginTop: Spacing.xs, gap: 2 },
    timelineCatchDetailLine: { fontSize: FontSize.xs, color: c.text, opacity: 0.85 },
    rowExpandBtn: { padding: Spacing.xs, paddingTop: 2 },
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
