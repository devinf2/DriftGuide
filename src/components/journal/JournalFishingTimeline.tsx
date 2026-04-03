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
import { v4 as uuidv4 } from 'uuid';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { FLY_NAMES } from '@/src/constants/fishingTypes';
import { fetchFlies, getFliesFromCache } from '@/src/services/flyService';
import { CatchDetailsModal } from '@/src/components/catch/CatchDetailsModal';
import {
  ChangeFlyPickerModal,
  mergeFlyPickerSelection,
  splitFlyChangeData,
} from '@/src/components/fly/ChangeFlyPickerModal';
import { BorderRadius, Colors, FontSize, Spacing } from '@/src/constants/theme';
import {
  deleteJournalTripEvent,
  fetchTripEvents,
  fetchTripsFromCloud,
  syncTripToCloud,
  updateTripTotalFishInCloud,
  upsertJournalTripEvent,
} from '@/src/services/sync';
import {
  findActiveFlyEventIdBefore,
  sortEventsByTime,
  timestampBetween,
  totalFishFromEvents,
  upsertEventSorted,
} from '@/src/utils/journalTimeline';
import type { TripEndpointKind } from '@/src/components/journal/TripEndpointPinModal';
import type { AIQueryData, CatchData, Fly, FlyChangeData, NoteData, Trip, TripEvent } from '@/src/types';
import { TimelineCatchPhotoStrip } from '@/src/components/catch/TimelineCatchPhotoStrip';
import { formatEventTime } from '@/src/utils/formatters';

type RowAction = { label: string; destructive?: boolean; onPress: () => void };

function formatCatchLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function CatchDetailsBlock({ data }: { data: CatchData }) {
  const lines: string[] = [];
  if (data.note?.trim()) lines.push(data.note.trim());
  if (data.depth_ft != null) lines.push(`Depth: ${data.depth_ft} ft`);
  if (data.structure) lines.push(`Structure: ${formatCatchLabel(data.structure)}`);
  if (data.presentation_method) lines.push(`Presentation: ${formatCatchLabel(data.presentation_method)}`);
  if (data.released != null) lines.push(`Released: ${data.released ? 'Yes' : 'No'}`);
  if (lines.length === 0) return null;
  return (
    <View style={styles.timelineCatchDetails}>
      {lines.map((line, i) => (
        <Text key={i} style={styles.timelineCatchDetailLine}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function getEventDescription(event: TripEvent): string {
  switch (event.event_type) {
    case 'catch': {
      const data = event.data as CatchData;
      const parts: string[] = [];
      if (data.species) parts.push(data.species);
      if (data.size_inches != null) parts.push(`${data.size_inches}"`);
      const qty = data.quantity != null && data.quantity > 1 ? data.quantity : 1;
      return parts.length
        ? `Caught ${parts.join(' · ')}${qty > 1 ? ` (×${qty})` : ''}`
        : qty > 1
          ? `${qty} fish caught!`
          : 'Fish caught!';
    }
    case 'fly_change': {
      const data = event.data as FlyChangeData;
      const primary = `${data.pattern}${data.size ? ` #${data.size}` : ''}`;
      return data.pattern2
        ? `Changed to ${primary} / ${data.pattern2}${data.size2 ? ` #${data.size2}` : ''}`
        : `Changed to ${primary}`;
    }
    case 'note': {
      const data = event.data as NoteData;
      return data.text;
    }
    case 'ai_query': {
      const data = event.data as AIQueryData;
      return `Asked: ${data.question}`;
    }
    default:
      return 'Event';
  }
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
}: JournalFishingTimelineProps) {
  const sorted = useMemo(() => sortEventsByTime(events), [events]);

  const [rowActions, setRowActions] = useState<{ event: TripEvent; index: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const [catchModal, setCatchModal] = useState<TripEvent | null>(null);
  const [noteModal, setNoteModal] = useState<TripEvent | null>(null);
  const [flyModal, setFlyModal] = useState<TripEvent | null>(null);
  const [aiModal, setAiModal] = useState<TripEvent | null>(null);
  const [userFlies, setUserFlies] = useState<Fly[]>([]);

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

  const reloadFromCloud = useCallback(async () => {
    const trips = await fetchTripsFromCloud(userId);
    const found = trips.find((t) => t.id === trip.id);
    if (found) onTripPatch(found);
    const ev = await fetchTripEvents(trip.id);
    onEventsChange(ev);
  }, [trip.id, userId, onEventsChange, onTripPatch]);

  const applyEventsAndTotals = useCallback(
    (next: TripEvent[]) => {
      onEventsChange(next);
      onTripPatch({ total_fish: totalFishFromEvents(next) });
    },
    [onEventsChange, onTripPatch],
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
        const d = e.data as FlyChangeData;
        return d.pattern2 ? [d.pattern, d.pattern2] : [d.pattern];
      }),
    ),
  ];

  const rowMenuActions: RowAction[] = useMemo(() => {
    if (!rowActions) return [];
    const { event, index } = rowActions;
    const actions: RowAction[] = [];

    if (event.event_type === 'catch') {
      actions.push({ label: 'Edit fish…', onPress: () => { closeRowMenu(); setCatchModal(event); } });
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
  }, [rowActions, closeRowMenu, insertNote, insertFish, insertFlyChange, confirmDelete, onRequestEditTripPin]);

  return (
    <View style={styles.root}>
      <ScrollView style={styles.tabContent} contentContainerStyle={styles.tabContentInner}>
        {uniqueFlies.length > 0 && (
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
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Timeline</Text>
          {editMode ? (
            <Text style={styles.editHint}>
              Tap ⋮ on a row to edit, insert notes, fish, or fly changes, adjust start/end locations from Trip
              started or Trip ended, or delete.
            </Text>
          ) : null}
          {sorted.length === 0 ? (
            <Text style={styles.emptyHint}>No events recorded for this trip.</Text>
          ) : (
            sorted.map((event, index) => (
              <View key={event.id} style={styles.timelineItem}>
                <Text style={styles.timelineTime}>{formatEventTime(event.timestamp)}</Text>
                <View style={styles.timelineContent}>
                  <View style={styles.timelineDot}>
                    {event.event_type === 'catch' ? (
                      <MaterialCommunityIcons name="fish" size={14} color={Colors.primary} />
                    ) : event.event_type === 'fly_change' ? (
                      <MaterialCommunityIcons name="hook" size={14} color={Colors.accent} />
                    ) : event.event_type === 'ai_query' ? (
                      <MaterialIcons name="smart-toy" size={14} color={Colors.info} />
                    ) : (
                      <MaterialIcons name="edit-note" size={14} color={Colors.textSecondary} />
                    )}
                  </View>
                  <View style={styles.timelineTextBlock}>
                    <Text style={styles.timelineText}>{getEventDescription(event)}</Text>
                    {event.event_type === 'catch' ? (
                      <CatchDetailsBlock data={event.data as CatchData} />
                    ) : null}
                    {event.event_type === 'catch' ? (
                      <TimelineCatchPhotoStrip
                        data={event.data as CatchData}
                        onPress={() => onCatchPhotoPress?.(event)}
                        imageStyle={styles.timelineCatchThumb}
                      />
                    ) : null}
                  </View>
                  {editMode ? (
                    <Pressable
                      style={styles.rowMenuBtn}
                      onPress={() => openRowMenu(event, index)}
                      hitSlop={12}
                      disabled={saving}
                    >
                      <MaterialIcons name="more-vert" size={22} color={Colors.textSecondary} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

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
          <ActivityIndicator color={Colors.primary} />
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
        allEvents={events}
        editingEvent={catchModal}
        onSubmitEdit={submitJournalCatchEdit}
      />
      <EditNoteModal
        visible={noteModal != null}
        event={noteModal}
        allEvents={events}
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
        flyPickerNames={flyPickerNames}
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

function EditNoteModal({
  visible,
  event,
  allEvents,
  onClose,
  onSaved,
}: {
  visible: boolean;
  event: TripEvent | null;
  allEvents: TripEvent[];
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
          placeholderTextColor={Colors.textTertiary}
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
  onClose,
  onSaved,
}: {
  visible: boolean;
  event: TripEvent | null;
  allEvents: TripEvent[];
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
              const next: TripEvent = {
                ...event,
                data: { question: q.trim() || 'Question', response: r.trim() || null } as AIQueryData,
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabContent: { flex: 1 },
  tabContentInner: { padding: Spacing.lg, gap: Spacing.md },
  section: { gap: Spacing.sm },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  editHint: { fontSize: FontSize.sm, color: Colors.textTertiary, marginBottom: Spacing.xs },
  emptyHint: { fontSize: FontSize.sm, color: Colors.textTertiary, textAlign: 'center' },
  flyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  flyChip: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  flyChipText: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.text },
  timelineItem: { flexDirection: 'row', gap: Spacing.md },
  timelineTime: { fontSize: FontSize.xs, color: Colors.textTertiary, width: 65, paddingTop: 2 },
  timelineContent: { flex: 1, flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  timelineDot: { width: 20, alignItems: 'center', paddingTop: 2 },
  timelineTextBlock: { flex: 1, gap: Spacing.sm },
  timelineText: { fontSize: FontSize.sm, color: Colors.text },
  timelineCatchThumb: { width: 72, height: 72, borderRadius: BorderRadius.sm, backgroundColor: Colors.surface },
  timelineCatchDetails: { marginTop: Spacing.xs, gap: 2 },
  timelineCatchDetailLine: { fontSize: FontSize.xs, color: Colors.textSecondary },
  rowMenuBtn: { padding: Spacing.xs },
  actionOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  actionSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    paddingBottom: Spacing.xl,
  },
  actionRow: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  actionLabel: { fontSize: FontSize.md, color: Colors.text },
  actionLabelDestructive: { color: Colors.error },
  actionCancel: { fontSize: FontSize.md, fontWeight: '600', color: Colors.primary, textAlign: 'center' },
  savingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  modalRoot: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  modalCancel: { fontSize: FontSize.md, color: Colors.textSecondary },
  modalSave: { fontSize: FontSize.md, fontWeight: '600', color: Colors.primary },
  modalScroll: { flex: 1, padding: Spacing.lg },
  fieldLabel: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary, marginBottom: Spacing.xs, marginTop: Spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.text,
    backgroundColor: Colors.surface,
  },
  tallInput: { minHeight: 80, textAlignVertical: 'top' },
  noteBody: {
    flex: 1,
    margin: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.text,
    textAlignVertical: 'top',
  },
});
