import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ExpoLocation from 'expo-location';
import { v4 as uuidv4 } from 'uuid';
import { MaterialIcons } from '@expo/vector-icons';
import { COMMON_SPECIES as SPECIES_OPTIONS, FLY_COLORS, FLY_NAMES, FLY_SIZES } from '@/src/constants/fishingTypes';
import { BorderRadius, Colors, FontSize, Spacing } from '@/src/constants/theme';
import { CatchPinPickerMap } from '@/src/components/map/CatchPinPickerMap';
import { addPhoto, PhotoQueuedOfflineError } from '@/src/services/photoService';
import { tripMapDefaultCenterCoordinate } from '@/src/utils/mapViewport';
import { upsertEventSorted } from '@/src/utils/journalTimeline';
import type {
  CatchData,
  Fly,
  FlyChangeData,
  PresentationMethod,
  Structure,
  Trip,
  TripEvent,
} from '@/src/types';

export type CatchDetailsSubmitAdd = {
  primary: FlyChangeData;
  dropper: FlyChangeData | null;
  catchFields: Partial<CatchData>;
  latitude: number | null;
  longitude: number | null;
  photoUri: string | null;
};

function buildFlyChangePayload(primary: FlyChangeData, dropper: FlyChangeData | null): FlyChangeData {
  const base: FlyChangeData = {
    pattern: primary.pattern,
    size: primary.size ?? null,
    color: primary.color ?? null,
    fly_id: primary.fly_id,
    fly_color_id: primary.fly_color_id,
    fly_size_id: primary.fly_size_id,
  };
  if (dropper?.pattern?.trim()) {
    return {
      ...base,
      pattern2: dropper.pattern,
      size2: dropper.size ?? null,
      color2: dropper.color ?? null,
      fly_id2: dropper.fly_id,
      fly_color_id2: dropper.fly_color_id,
      fly_size_id2: dropper.fly_size_id,
    };
  }
  return base;
}

function flyDataMatches(a: FlyChangeData, b: FlyChangeData): boolean {
  return (
    a.pattern === b.pattern &&
    (a.size ?? null) === (b.size ?? null) &&
    (a.color ?? null) === (b.color ?? null) &&
    (a.pattern2 ?? null) === (b.pattern2 ?? null) &&
    (a.size2 ?? null) === (b.size2 ?? null) &&
    (a.color2 ?? null) === (b.color2 ?? null)
  );
}

function mergeEditCatchEvents(
  allEvents: TripEvent[],
  editing: TripEvent,
  primary: FlyChangeData,
  dropper: FlyChangeData | null,
  catchData: CatchData,
  latitude: number | null,
  longitude: number | null,
): TripEvent[] {
  const newFlyPayload = buildFlyChangePayload(primary, dropper);
  const linkedId = catchData.active_fly_event_id;
  const linkedFly = linkedId
    ? allEvents.find((e) => e.id === linkedId && e.event_type === 'fly_change')
    : null;
  const linkedData = linkedFly ? (linkedFly.data as FlyChangeData) : null;
  const flyUnchanged = linkedData != null && flyDataMatches(linkedData, newFlyPayload);

  let activeFlyId = catchData.active_fly_event_id;
  let events = allEvents;

  if (!flyUnchanged) {
    const newFlyId = uuidv4();
    const tCatch = new Date(editing.timestamp).getTime();
    const flyTs = new Date(Math.max(0, tCatch - 2)).toISOString();
    const flyEvent: TripEvent = {
      id: newFlyId,
      trip_id: editing.trip_id,
      event_type: 'fly_change',
      timestamp: flyTs,
      data: newFlyPayload,
      conditions_snapshot: null,
      latitude: null,
      longitude: null,
    };
    events = upsertEventSorted(events, flyEvent);
    activeFlyId = newFlyId;
  }

  const nextCatch: TripEvent = {
    ...editing,
    latitude,
    longitude,
    data: { ...catchData, active_fly_event_id: activeFlyId },
  };
  return upsertEventSorted(events, nextCatch);
}

export type CatchDetailsModalProps = {
  visible: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  titleAdd?: string;
  titleEdit?: string;
  trip: Trip;
  userId: string;
  isConnected: boolean;
  userFlies: Fly[];
  /** When user fly box empty, fall back to these names */
  flyPickerNames?: string[];
  allEvents: TripEvent[];
  editingEvent?: TripEvent | null;
  /** Add mode: seed rig from current trip state */
  seedPrimary?: FlyChangeData | null;
  seedDropper?: FlyChangeData | null;
  getPresentationForFly?: (name: string, size: number | null, color: string | null) => PresentationMethod | null;
  onSubmitAdd?: (payload: CatchDetailsSubmitAdd) => Promise<void>;
  onSubmitEdit?: (nextEvents: TripEvent[]) => Promise<void>;
  onPickPhoto?: (source: 'camera' | 'library') => void;
};

export function CatchDetailsModal({
  visible,
  onClose,
  mode,
  titleAdd = 'Add fish details',
  titleEdit = 'Edit fish',
  trip,
  userId,
  isConnected,
  userFlies,
  flyPickerNames = FLY_NAMES,
  allEvents,
  editingEvent,
  seedPrimary,
  seedDropper,
  getPresentationForFly,
  onSubmitAdd,
  onSubmitEdit,
  onPickPhoto: onPickPhotoProp,
}: CatchDetailsModalProps) {
  const [catchFlyName, setCatchFlyName] = useState('');
  const [catchFlySize, setCatchFlySize] = useState<number | null>(null);
  const [catchFlyColor, setCatchFlyColor] = useState<string | null>(null);
  const [catchFlyName2, setCatchFlyName2] = useState<string | null>(null);
  const [catchFlySize2, setCatchFlySize2] = useState<number | null>(null);
  const [catchFlyColor2, setCatchFlyColor2] = useState<string | null>(null);
  const [catchSpecies, setCatchSpecies] = useState('');
  const [catchSize, setCatchSize] = useState('');
  const [catchNote, setCatchNote] = useState('');
  const [catchQty, setCatchQty] = useState('1');
  const [catchDepth, setCatchDepth] = useState('');
  const [catchPhotoUri, setCatchPhotoUri] = useState<string | null>(null);
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const [catchCaughtOnFly, setCatchCaughtOnFly] = useState<'primary' | 'dropper'>('primary');
  const [catchPresentation, setCatchPresentation] = useState<PresentationMethod | null>(null);
  const [catchReleased, setCatchReleased] = useState<boolean | null>(true);
  const [catchStructure, setCatchStructure] = useState<Structure | null>(null);
  const [pinLat, setPinLat] = useState<number | null>(null);
  const [pinLon, setPinLon] = useState<number | null>(null);
  const [latText, setLatText] = useState('');
  const [lonText, setLonText] = useState('');
  const [catchFlyDropdownOpen, setCatchFlyDropdownOpen] = useState<
    null | 'name' | 'size' | 'color' | 'name2' | 'size2' | 'color2'
  >(null);
  const [catchSpeciesDropdownOpen, setCatchSpeciesDropdownOpen] = useState(false);
  const [flyNameSearch, setFlyNameSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [coordRecenterTick, setCoordRecenterTick] = useState(0);
  /** Until true, map uses editingEvent coords so we don't flash the previous catch's pin. */
  const [editPinFormSynced, setEditPinFormSynced] = useState(false);
  const [gpsFillBusy, setGpsFillBusy] = useState(false);

  const mapFallbackCenter = useMemo(() => tripMapDefaultCenterCoordinate(trip), [trip]);

  /** Fly Box names + catalog list (deduped), same idea as active trip screen */
  const effectiveFlyPickerNames = useMemo(() => {
    const fromBox = [...new Set(userFlies.map((f) => f.name).filter((n) => n?.trim()))].sort();
    const base = flyPickerNames?.length ? flyPickerNames : FLY_NAMES;
    if (fromBox.length === 0) return base;
    return [...new Set([...fromBox, ...base])].sort();
  }, [userFlies, flyPickerNames]);

  const flyNamesWithOther = useMemo(() => {
    const hasOther = effectiveFlyPickerNames.some((n) => n === 'Other');
    return hasOther ? effectiveFlyPickerNames : [...effectiveFlyPickerNames, 'Other'];
  }, [effectiveFlyPickerNames]);

  const filteredFlyNames = useMemo(() => {
    const q = flyNameSearch.trim().toLowerCase();
    if (!q) return flyNamesWithOther;
    const filtered = flyNamesWithOther.filter((n) => n.toLowerCase().includes(q));
    return filtered.includes('Other') ? filtered : [...filtered, 'Other'];
  }, [flyNamesWithOther, flyNameSearch]);

  const catchFlyDropdownOptions: { label: string; value: string | number }[] =
    catchFlyDropdownOpen === null
      ? []
      : catchFlyDropdownOpen === 'name' || catchFlyDropdownOpen === 'name2'
        ? filteredFlyNames.map((n) => ({ label: n, value: n }))
        : catchFlyDropdownOpen === 'size' || catchFlyDropdownOpen === 'size2'
          ? FLY_SIZES.map((s) => ({ label: `#${s}`, value: s }))
          : FLY_COLORS.map((c) => ({ label: c, value: c }));

  const resetFormForAdd = useCallback(() => {
    const p = seedPrimary;
    const d = seedDropper;
    setCatchFlyName(p?.pattern ?? effectiveFlyPickerNames[0] ?? '');
    setCatchFlySize(p?.size ?? null);
    setCatchFlyColor(p?.color ?? null);
    setCatchFlyName2(d?.pattern ?? null);
    setCatchFlySize2(d?.size ?? null);
    setCatchFlyColor2(d?.color ?? null);
    setCatchSpecies('');
    setCatchSize('');
    setCatchNote('');
    setCatchQty('1');
    setCatchDepth('');
    setCatchPhotoUri(null);
    setExistingPhotoUrl(null);
    setCatchCaughtOnFly('primary');
    setCatchReleased(true);
    setCatchStructure(null);
    setPinLat(null);
    setPinLon(null);
    setLatText('');
    setLonText('');
    if (p?.pattern && getPresentationForFly) {
      setCatchPresentation(getPresentationForFly(p.pattern, p.size ?? null, p.color ?? null));
    } else {
      setCatchPresentation(null);
    }
  }, [seedPrimary, seedDropper, effectiveFlyPickerNames, getPresentationForFly]);

  const loadFormForEdit = useCallback(
    (ev: TripEvent) => {
      const data = ev.data as CatchData;
      const flyEv = data.active_fly_event_id
        ? allEvents.find((e) => e.id === data.active_fly_event_id && e.event_type === 'fly_change')
        : null;
      const fd = flyEv ? (flyEv.data as FlyChangeData) : null;
      setCatchFlyName(fd?.pattern ?? '');
      setCatchFlySize(fd?.size ?? null);
      setCatchFlyColor(fd?.color ?? null);
      if (fd?.pattern2) {
        setCatchFlyName2(fd.pattern2);
        setCatchFlySize2(fd.size2 ?? null);
        setCatchFlyColor2(fd.color2 ?? null);
      } else {
        setCatchFlyName2(null);
        setCatchFlySize2(null);
        setCatchFlyColor2(null);
      }
      setCatchSpecies(data.species ?? '');
      setCatchSize(data.size_inches != null ? String(data.size_inches) : '');
      setCatchNote(data.note ?? '');
      setCatchQty(String(Math.max(1, data.quantity ?? 1)));
      setCatchDepth(data.depth_ft != null ? String(data.depth_ft) : '');
      setCatchPhotoUri(null);
      setExistingPhotoUrl(data.photo_url ?? null);
      setCatchCaughtOnFly(data.caught_on_fly ?? 'primary');
      setCatchPresentation(data.presentation_method ?? null);
      setCatchReleased(data.released ?? null);
      setCatchStructure(data.structure ?? null);
      const laRaw = ev.latitude;
      const loRaw = ev.longitude;
      const la =
        laRaw == null ? null : typeof laRaw === 'number' ? laRaw : Number(laRaw);
      const lo =
        loRaw == null ? null : typeof loRaw === 'number' ? loRaw : Number(loRaw);
      const laOk = la != null && Number.isFinite(la) ? la : null;
      const loOk = lo != null && Number.isFinite(lo) ? lo : null;
      setPinLat(laOk);
      setPinLon(loOk);
      setLatText(laOk != null ? String(laOk) : '');
      setLonText(loOk != null ? String(loOk) : '');
      setEditPinFormSynced(true);
    },
    [allEvents],
  );

  /** Edit: load before paint so lat/lon fields and map show the catch immediately (avoids empty fields until interaction). */
  useLayoutEffect(() => {
    if (!visible || mode !== 'edit' || !editingEvent) return;
    loadFormForEdit(editingEvent);
  }, [visible, mode, editingEvent?.id, loadFormForEdit]);

  useEffect(() => {
    if (!visible || mode !== 'add') return;
    resetFormForAdd();
    (async () => {
      try {
        const { status } = await ExpoLocation.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await ExpoLocation.getCurrentPositionAsync({
            accuracy: ExpoLocation.Accuracy.Balanced,
          });
          setPinLat(loc.coords.latitude);
          setPinLon(loc.coords.longitude);
          setLatText(String(loc.coords.latitude));
          setLonText(String(loc.coords.longitude));
        }
      } catch {
        /* optional */
      }
    })();
  }, [visible, mode, resetFormForAdd]);

  useEffect(() => {
    if (!visible || mode !== 'add' || !catchFlyName?.trim() || !getPresentationForFly) return;
    setCatchPresentation(getPresentationForFly(catchFlyName, catchFlySize, catchFlyColor));
  }, [visible, mode, catchFlyName, catchFlySize, catchFlyColor, getPresentationForFly]);

  useEffect(() => {
    setCoordRecenterTick(0);
  }, [editingEvent?.id]);

  const syncPinFromText = useCallback(() => {
    const la = latText.trim() ? Number(latText.trim()) : NaN;
    const lo = lonText.trim() ? Number(lonText.trim()) : NaN;
    if (Number.isFinite(la) && Number.isFinite(lo)) {
      setPinLat(la);
      setPinLon(lo);
      if (mode === 'edit') {
        setCoordRecenterTick((t) => t + 1);
      }
    }
  }, [latText, lonText, mode]);

  const onCoordinateChange = useCallback(
    (lat: number, lng: number) => {
      if (mode === 'edit' && !editPinFormSynced) return;
      setPinLat(lat);
      setPinLon(lng);
      setLatText(String(lat));
      setLonText(String(lng));
    },
    [mode, editPinFormSynced],
  );

  const fillCoordsFromDevice = useCallback(async () => {
    setGpsFillBusy(true);
    try {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location', 'Allow location to use your current position for coordinates.');
        return;
      }
      const loc = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;
      setPinLat(lat);
      setPinLon(lng);
      setLatText(String(lat));
      setLonText(String(lng));
      if (mode === 'edit') {
        setEditPinFormSynced(true);
        setCoordRecenterTick((t) => t + 1);
      }
    } catch {
      Alert.alert('Location', 'Could not read GPS.');
    } finally {
      setGpsFillBusy(false);
    }
  }, [mode]);

  const mapDisplayLat =
    mode === 'edit' && editingEvent && !editPinFormSynced
      ? editingEvent.latitude ?? null
      : pinLat;
  const mapDisplayLon =
    mode === 'edit' && editingEvent && !editPinFormSynced
      ? editingEvent.longitude ?? null
      : pinLon;

  const handleCatchFlyDropdownSelect = (value: string | number) => {
    if (catchFlyDropdownOpen === 'name') setCatchFlyName(String(value));
    else if (catchFlyDropdownOpen === 'size') setCatchFlySize(value as number);
    else if (catchFlyDropdownOpen === 'color') setCatchFlyColor(String(value));
    else if (catchFlyDropdownOpen === 'name2') setCatchFlyName2(String(value));
    else if (catchFlyDropdownOpen === 'size2') setCatchFlySize2(value as number);
    else if (catchFlyDropdownOpen === 'color2') setCatchFlyColor2(String(value));
    setCatchFlyDropdownOpen(null);
  };

  const pickPhotoInternal = async (source: 'camera' | 'library') => {
    if (onPickPhotoProp) {
      onPickPhotoProp(source);
      return;
    }
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.85 });
      if (!result.canceled && result.assets?.[0]?.uri) setCatchPhotoUri(result.assets[0].uri);
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo library access to choose a photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
      });
      if (!result.canceled && result.assets?.[0]?.uri) setCatchPhotoUri(result.assets[0].uri);
    }
  };

  const resolvePrimaryDropper = (): { primary: FlyChangeData; dropper: FlyChangeData | null } | null => {
    if (!catchFlyName.trim()) return null;
    const matchPrimary = userFlies.find(
      (f) =>
        f.name === catchFlyName.trim() &&
        (f.size ?? null) === (catchFlySize ?? null) &&
        (f.color ?? null) === (catchFlyColor ?? null),
    );
    const primary: FlyChangeData = {
      pattern: catchFlyName.trim(),
      size: catchFlySize ?? null,
      color: catchFlyColor ?? null,
      fly_id: matchPrimary?.fly_id,
      fly_color_id: matchPrimary?.fly_color_id,
      fly_size_id: matchPrimary?.fly_size_id,
    };
    const dropper =
      catchFlyName2 != null && catchFlyName2.trim()
        ? (() => {
            const match2 = userFlies.find(
              (f) =>
                f.name === catchFlyName2.trim() &&
                (f.size ?? null) === (catchFlySize2 ?? null) &&
                (f.color ?? null) === (catchFlyColor2 ?? null),
            );
            return {
              pattern: catchFlyName2.trim(),
              size: catchFlySize2 ?? null,
              color: catchFlyColor2 ?? null,
              fly_id: match2?.fly_id,
              fly_color_id: match2?.fly_color_id,
              fly_size_id: match2?.fly_size_id,
            } as FlyChangeData;
          })()
        : null;
    return { primary, dropper };
  };

  const handleSubmit = async () => {
    const rig = resolvePrimaryDropper();
    if (!rig) {
      Alert.alert('Fly required', 'Choose a fly name for this catch.');
      return;
    }
    const { primary, dropper } = rig;
    const species = catchSpecies.trim() || null;
    const sizeNum = catchSize.trim() ? parseFloat(catchSize.trim()) : null;
    const depthNum = catchDepth.trim() ? parseFloat(catchDepth.trim()) : null;
    const qty = Math.max(1, Math.floor(Number(catchQty) || 1));
    syncPinFromText();
    const lat = pinLat;
    const lon = pinLon;

    setSubmitting(true);
    try {
      if (mode === 'add') {
        if (!onSubmitAdd) {
          Alert.alert('Error', 'Missing save handler.');
          setSubmitting(false);
          return;
        }
        await onSubmitAdd({
          primary,
          dropper,
          catchFields: {
            species: species ?? undefined,
            size_inches: sizeNum ?? undefined,
            note: catchNote.trim() || undefined,
            caught_on_fly: catchCaughtOnFly,
            quantity: qty,
            depth_ft: depthNum ?? undefined,
            presentation_method: catchPresentation ?? undefined,
            released: catchReleased ?? undefined,
            structure: catchStructure ?? undefined,
          },
          latitude: lat,
          longitude: lon,
          photoUri: catchPhotoUri,
        });
        onClose();
      } else if (mode === 'edit' && editingEvent && onSubmitEdit) {
        let photoUrl = existingPhotoUrl;
        if (catchPhotoUri && isConnected) {
          try {
            const useDropper = catchCaughtOnFly === 'dropper' && dropper?.pattern?.trim();
            const p = await addPhoto(
              {
                userId,
                tripId: trip.id,
                uri: catchPhotoUri,
                caption: catchNote.trim() || undefined,
                species: species ?? undefined,
                fly_pattern: (useDropper ? dropper!.pattern : primary.pattern) || undefined,
                fly_size: (useDropper ? dropper!.size : primary.size) ?? undefined,
                fly_color: (useDropper ? dropper!.color : primary.color) ?? undefined,
                fly_id: useDropper ? dropper!.fly_id : primary.fly_id,
                captured_at: editingEvent.timestamp,
              },
              { isOnline: true },
            );
            photoUrl = p.url;
          } catch (e) {
            if (e instanceof PhotoQueuedOfflineError) Alert.alert('Offline', e.message);
            else Alert.alert('Photo', (e as Error).message);
            setSubmitting(false);
            return;
          }
        } else if (catchPhotoUri && !isConnected) {
          Alert.alert('Offline', 'Connect to upload a new photo.');
          setSubmitting(false);
          return;
        }

        const catchData: CatchData = {
          species,
          size_inches: sizeNum != null && Number.isFinite(sizeNum) ? sizeNum : null,
          note: catchNote.trim() || null,
          photo_url: catchPhotoUri ? photoUrl : existingPhotoUrl,
          active_fly_event_id: (editingEvent.data as CatchData).active_fly_event_id,
          caught_on_fly: catchCaughtOnFly,
          quantity: qty,
          depth_ft: depthNum != null && Number.isFinite(depthNum) ? depthNum : null,
          presentation_method: catchPresentation,
          released: catchReleased,
          structure: catchStructure,
        };

        const nextEvents = mergeEditCatchEvents(
          allEvents,
          editingEvent,
          primary,
          dropper,
          catchData,
          lat,
          lon,
        );
        await onSubmitEdit(nextEvents);
        onClose();
      }
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'add' ? titleAdd : titleEdit;

  const latLonFineTune = (
    <>
      <View style={styles.coordHintRow}>
        <Text style={[styles.coordHint, styles.coordHintInRow]}>Optional: fine-tune coordinates</Text>
        <Pressable
          style={({ pressed }) => [styles.useGpsButton, pressed && styles.useGpsButtonPressed]}
          onPress={() => void fillCoordsFromDevice()}
          disabled={gpsFillBusy}
          accessibilityRole="button"
          accessibilityLabel="Fill latitude and longitude using current location"
        >
          {gpsFillBusy ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <MaterialIcons name="my-location" size={18} color={Colors.primary} />
          )}
          <Text style={styles.useGpsButtonText}>Use current location</Text>
        </Pressable>
      </View>
      <View style={styles.coordRow}>
        <TextInput
          style={[styles.catchModalInput, styles.coordInput]}
          placeholder="Latitude"
          placeholderTextColor={Colors.textTertiary}
          value={latText}
          onChangeText={setLatText}
          onBlur={syncPinFromText}
          keyboardType="numbers-and-punctuation"
        />
        <TextInput
          style={[styles.catchModalInput, styles.coordInput]}
          placeholder="Longitude"
          placeholderTextColor={Colors.textTertiary}
          value={lonText}
          onChangeText={setLonText}
          onBlur={syncPinFromText}
          keyboardType="numbers-and-punctuation"
        />
      </View>
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.catchModalBackdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
        />
        <View style={styles.catchModalOverlay}>
          <View style={styles.catchModal} onStartShouldSetResponder={() => true}>
            <View style={styles.catchModalHeader}>
              <Text style={styles.catchModalTitle} numberOfLines={1}>
                {title}
              </Text>
              {mode === 'edit' ? (
                <Pressable
                  onPress={() => {
                    Keyboard.dismiss();
                    onClose();
                  }}
                  hitSlop={12}
                  style={styles.catchModalHeaderClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <MaterialIcons name="close" size={24} color={Colors.text} />
                </Pressable>
              ) : null}
            </View>
            <ScrollView
              style={styles.catchModalScroll}
              contentContainerStyle={styles.catchModalScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {mode === 'add' ? (
                <>
                  <CatchPinPickerMap
                    latitude={pinLat}
                    longitude={pinLon}
                    onCoordinateChange={onCoordinateChange}
                    height={200}
                    mapFallbackCenter={mapFallbackCenter}
                  />
                  {latLonFineTune}
                </>
              ) : null}

              <Text style={styles.flyFieldLabel}>{catchFlyName2 != null ? 'Primary fly' : 'Fly'}</Text>
              <View style={styles.catchFlyDropdownRowWrap}>
                <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('name')}>
                  <Text
                    style={[styles.catchFlyDropdownValue, !catchFlyName && styles.catchFlyDropdownPlaceholder]}
                    numberOfLines={1}
                  >
                    {catchFlyName || 'Name'}
                  </Text>
                  <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
                </Pressable>
                <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('size')}>
                  <Text
                    style={[
                      styles.catchFlyDropdownValue,
                      catchFlySize == null && styles.catchFlyDropdownPlaceholder,
                    ]}
                    numberOfLines={1}
                  >
                    {catchFlySize != null ? `#${catchFlySize}` : 'Size'}
                  </Text>
                  <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
                </Pressable>
                <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('color')}>
                  <Text
                    style={[styles.catchFlyDropdownValue, !catchFlyColor && styles.catchFlyDropdownPlaceholder]}
                    numberOfLines={1}
                  >
                    {catchFlyColor || 'Color'}
                  </Text>
                  <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
                </Pressable>
              </View>

              {catchFlyName2 != null ? (
                <>
                  <Text style={[styles.flyFieldLabel, { marginTop: Spacing.md }]}>Dropper</Text>
                  <Pressable
                    style={[styles.addDropperButton, { marginBottom: Spacing.sm }]}
                    onPress={() => {
                      setCatchFlyName2(null);
                      setCatchFlySize2(null);
                      setCatchFlyColor2(null);
                    }}
                  >
                    <Text style={styles.addDropperButtonText}>Remove dropper</Text>
                  </Pressable>
                  <View style={styles.catchFlyDropdownRowWrap}>
                    <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('name2')}>
                      <Text
                        style={[
                          styles.catchFlyDropdownValue,
                          !catchFlyName2 && styles.catchFlyDropdownPlaceholder,
                        ]}
                        numberOfLines={1}
                      >
                        {catchFlyName2 || 'Name'}
                      </Text>
                      <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
                    </Pressable>
                    <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('size2')}>
                      <Text
                        style={[
                          styles.catchFlyDropdownValue,
                          catchFlySize2 == null && styles.catchFlyDropdownPlaceholder,
                        ]}
                        numberOfLines={1}
                      >
                        {catchFlySize2 != null ? `#${catchFlySize2}` : 'Size'}
                      </Text>
                      <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
                    </Pressable>
                    <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('color2')}>
                      <Text
                        style={[
                          styles.catchFlyDropdownValue,
                          !catchFlyColor2 && styles.catchFlyDropdownPlaceholder,
                        ]}
                        numberOfLines={1}
                      >
                        {catchFlyColor2 || 'Color'}
                      </Text>
                      <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
                    </Pressable>
                  </View>
                  <Text style={styles.flyFieldLabel}>Which fly caught?</Text>
                  <View style={styles.catchFlyRadioRow}>
                    <Pressable style={styles.catchFlyRadioOption} onPress={() => setCatchCaughtOnFly('primary')}>
                      <MaterialIcons
                        name={catchCaughtOnFly === 'primary' ? 'radio-button-checked' : 'radio-button-unchecked'}
                        size={22}
                        color={catchCaughtOnFly === 'primary' ? Colors.primary : Colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.catchFlyRadioLabel,
                          catchCaughtOnFly === 'primary' && styles.catchFlyRadioLabelActive,
                        ]}
                      >
                        {catchFlyName}
                        {catchFlySize ? ` #${catchFlySize}` : ''}
                      </Text>
                    </Pressable>
                    <Pressable style={styles.catchFlyRadioOption} onPress={() => setCatchCaughtOnFly('dropper')}>
                      <MaterialIcons
                        name={catchCaughtOnFly === 'dropper' ? 'radio-button-checked' : 'radio-button-unchecked'}
                        size={22}
                        color={catchCaughtOnFly === 'dropper' ? Colors.primary : Colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.catchFlyRadioLabel,
                          catchCaughtOnFly === 'dropper' && styles.catchFlyRadioLabelActive,
                        ]}
                      >
                        {catchFlyName2}
                        {catchFlySize2 ? ` #${catchFlySize2}` : ''}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Pressable
                  style={styles.addDropperButton}
                  onPress={() => {
                    setCatchFlyName2(flyPickerNames[0] ?? '');
                    setCatchFlySize2(null);
                    setCatchFlyColor2(null);
                  }}
                >
                  <Text style={styles.addDropperButtonText}>Add dropper</Text>
                </Pressable>
              )}

              <Text style={styles.flyFieldLabel}>Photo</Text>
              <View style={styles.catchPhotoRow}>
                {catchPhotoUri || existingPhotoUrl ? (
                  <View style={styles.catchPhotoPreviewWrap}>
                    <Image
                      source={{ uri: catchPhotoUri ?? existingPhotoUrl! }}
                      style={styles.catchPhotoPreview}
                    />
                    <Pressable
                      style={styles.catchPhotoRemove}
                      onPress={() => {
                        setCatchPhotoUri(null);
                        setExistingPhotoUrl(null);
                      }}
                    >
                      <MaterialIcons name="close" size={18} color={Colors.textInverse} />
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Pressable style={styles.catchPhotoButton} onPress={() => void pickPhotoInternal('camera')}>
                      <MaterialIcons name="photo-camera" size={22} color={Colors.primary} />
                      <Text style={styles.catchPhotoButtonLabel}>Camera</Text>
                    </Pressable>
                    <Pressable style={styles.catchPhotoButton} onPress={() => void pickPhotoInternal('library')}>
                      <MaterialIcons name="photo-library" size={22} color={Colors.primary} />
                      <Text style={styles.catchPhotoButtonLabel}>Upload</Text>
                    </Pressable>
                  </>
                )}
              </View>

              <Text style={styles.flyFieldLabel}>Notes</Text>
              <TextInput
                style={[styles.catchModalInput, styles.catchModalNoteInput]}
                placeholder="Optional note"
                placeholderTextColor={Colors.textTertiary}
                value={catchNote}
                onChangeText={setCatchNote}
                multiline
              />
              <Text style={styles.flyFieldLabel}>Size (inches)</Text>
              <TextInput
                style={styles.catchModalInput}
                placeholder="e.g. 14"
                placeholderTextColor={Colors.textTertiary}
                value={catchSize}
                onChangeText={setCatchSize}
                keyboardType="decimal-pad"
              />
              <Text style={styles.flyFieldLabel}>Quantity</Text>
              <TextInput
                style={styles.catchModalInput}
                placeholder="1"
                placeholderTextColor={Colors.textTertiary}
                value={catchQty}
                onChangeText={setCatchQty}
                keyboardType="number-pad"
              />
              <Text style={styles.flyFieldLabel}>Species</Text>
              <Pressable style={styles.catchFlyDropdownRow} onPress={() => setCatchSpeciesDropdownOpen(true)}>
                <Text
                  style={[styles.catchFlyDropdownValue, !catchSpecies && styles.catchFlyDropdownPlaceholder]}
                  numberOfLines={1}
                >
                  {catchSpecies || 'Select species'}
                </Text>
                <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
              </Pressable>
              {(!catchSpecies || !SPECIES_OPTIONS.includes(catchSpecies)) && (
                <TextInput
                  style={styles.catchModalInput}
                  placeholder="Species name (when Other is selected)"
                  placeholderTextColor={Colors.textTertiary}
                  value={catchSpecies}
                  onChangeText={setCatchSpecies}
                />
              )}
              <Text style={styles.flyFieldLabel}>Catch Depth</Text>
              <TextInput
                style={styles.catchModalInput}
                placeholder="e.g. 3"
                placeholderTextColor={Colors.textTertiary}
                value={catchDepth}
                onChangeText={setCatchDepth}
                keyboardType="decimal-pad"
              />
              <Text style={styles.flyFieldLabel}>Presentation</Text>
              <View style={styles.chipRow}>
                {(['dry', 'nymph', 'streamer', 'wet', 'other'] as const).map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.chip, catchPresentation === m && styles.chipActive]}
                    onPress={() => setCatchPresentation(m)}
                  >
                    <Text style={[styles.chipText, catchPresentation === m && styles.chipTextActive]}>
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.flyFieldLabel}>Released?</Text>
              <View style={styles.chipRow}>
                <Pressable
                  style={[styles.chip, catchReleased === true && styles.chipActive]}
                  onPress={() => setCatchReleased(true)}
                >
                  <Text style={[styles.chipText, catchReleased === true && styles.chipTextActive]}>Released</Text>
                </Pressable>
                <Pressable
                  style={[styles.chip, catchReleased === false && styles.chipActive]}
                  onPress={() => setCatchReleased(false)}
                >
                  <Text style={[styles.chipText, catchReleased === false && styles.chipTextActive]}>Kept</Text>
                </Pressable>
              </View>
              <Text style={styles.flyFieldLabel}>Water Structure</Text>
              <View style={styles.chipRow}>
                {(['pool', 'riffle', 'run', 'undercut_bank', 'eddy', 'other'] as const).map((s) => (
                  <Pressable
                    key={s}
                    style={[styles.chip, catchStructure === s && styles.chipActive]}
                    onPress={() => setCatchStructure(s)}
                  >
                    <Text style={[styles.chipText, catchStructure === s && styles.chipTextActive]}>
                      {s === 'undercut_bank' ? 'Undercut' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {mode === 'edit' ? (
                <>
                  <Text style={[styles.flyFieldLabel, { marginTop: Spacing.lg }]}>Catch location</Text>
                  <CatchPinPickerMap
                    latitude={mapDisplayLat}
                    longitude={mapDisplayLon}
                    onCoordinateChange={onCoordinateChange}
                    height={220}
                    interactionMode="pan_center"
                    focusRequestKey={`${editingEvent?.id ?? 'edit'}-${coordRecenterTick}`}
                    mapFallbackCenter={mapFallbackCenter}
                    hintPosition="below"
                  />
                  {latLonFineTune}
                </>
              ) : null}
            </ScrollView>

            {catchFlyDropdownOpen !== null ? (
              <View style={styles.pickerOverlayHost} pointerEvents="box-none">
                <Pressable
                  style={styles.pickerBackdrop}
                  onPress={() => {
                    Keyboard.dismiss();
                    setCatchFlyDropdownOpen(null);
                  }}
                />
                <View style={styles.catchFlyPickerSheet}>
                  {(catchFlyDropdownOpen === 'name' || catchFlyDropdownOpen === 'name2') && (
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Search flies…"
                      placeholderTextColor={Colors.textTertiary}
                      value={flyNameSearch}
                      onChangeText={setFlyNameSearch}
                    />
                  )}
                  <ScrollView style={styles.catchFlyPickerList} keyboardShouldPersistTaps="handled">
                    {catchFlyDropdownOptions.map((opt) => {
                      const isSelected =
                        (catchFlyDropdownOpen === 'name' && opt.value === catchFlyName) ||
                        (catchFlyDropdownOpen === 'size' && opt.value === catchFlySize) ||
                        (catchFlyDropdownOpen === 'color' && opt.value === catchFlyColor) ||
                        (catchFlyDropdownOpen === 'name2' && opt.value === catchFlyName2) ||
                        (catchFlyDropdownOpen === 'size2' && opt.value === catchFlySize2) ||
                        (catchFlyDropdownOpen === 'color2' && opt.value === catchFlyColor2);
                      return (
                        <Pressable
                          key={String(opt.value)}
                          style={[styles.catchFlyPickerOption, isSelected && styles.catchFlyPickerOptionActive]}
                          onPress={() => handleCatchFlyDropdownSelect(opt.value)}
                        >
                          <Text
                            style={[
                              styles.catchFlyPickerOptionText,
                              isSelected && styles.catchFlyPickerOptionTextActive,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>
            ) : null}

            {catchSpeciesDropdownOpen ? (
              <View style={styles.pickerOverlayHost} pointerEvents="box-none">
                <Pressable
                  style={styles.pickerBackdrop}
                  onPress={() => {
                    Keyboard.dismiss();
                    setCatchSpeciesDropdownOpen(false);
                  }}
                />
                <View style={styles.catchFlyPickerSheet}>
                  <ScrollView style={styles.catchFlyPickerList} keyboardShouldPersistTaps="handled">
                    {SPECIES_OPTIONS.map((species) => {
                      const isOther = species === 'Other';
                      const isSelected = isOther
                        ? !catchSpecies || !SPECIES_OPTIONS.slice(0, -1).includes(catchSpecies)
                        : catchSpecies === species;
                      return (
                        <Pressable
                          key={species}
                          style={[styles.catchFlyPickerOption, isSelected && styles.catchFlyPickerOptionActive]}
                          onPress={() => {
                            setCatchSpecies(isOther ? '' : species);
                            setCatchSpeciesDropdownOpen(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.catchFlyPickerOptionText,
                              isSelected && styles.catchFlyPickerOptionTextActive,
                            ]}
                          >
                            {species}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>
            ) : null}

            <View style={styles.catchModalActions}>
              <Pressable
                style={styles.catchModalCancel}
                onPress={() => {
                  setCatchPhotoUri(null);
                  onClose();
                }}
              >
                <Text style={styles.catchModalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.confirmFlyButton}
                onPress={() => void handleSubmit()}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <Text style={styles.confirmFlyButtonText}>{mode === 'add' ? 'Add fish' : 'Save'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  catchModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  catchModalOverlay: {
    width: '100%',
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
    maxWidth: 400,
  },
  catchModal: {
    alignSelf: 'stretch',
    width: '100%',
    height: '88%',
    maxHeight: '88%',
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    position: 'relative',
    overflow: 'hidden',
  },
  catchModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  catchModalHeaderClose: {
    padding: Spacing.xs,
    marginRight: -Spacing.xs,
  },
  catchModalScroll: { flex: 1 },
  catchModalScrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  catchModalTitle: {
    flex: 1,
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  coordHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginBottom: Spacing.xs,
  },
  coordHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  coordHintInRow: {
    flex: 1,
    marginBottom: 0,
  },
  useGpsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  useGpsButtonPressed: { opacity: 0.75 },
  useGpsButtonText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.primary,
  },
  coordRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  coordInput: { flex: 1 },
  flyFieldLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  catchFlyDropdownRowWrap: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  catchFlyDropdownCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catchFlyDropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catchFlyDropdownValue: {
    fontSize: FontSize.sm,
    color: Colors.text,
    flex: 1,
  },
  catchFlyDropdownPlaceholder: { color: Colors.textTertiary },
  /** In-modal overlay (nested <Modal> breaks fly/species lists on iOS) */
  pickerOverlayHost: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 50,
    elevation: 50,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  catchFlyPickerSheet: {
    alignSelf: 'stretch',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    maxHeight: '58%',
    marginHorizontal: Spacing.xs,
  },
  searchInput: {
    margin: Spacing.sm,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    fontSize: FontSize.md,
    color: Colors.text,
  },
  catchFlyPickerList: { maxHeight: 320 },
  catchFlyPickerOption: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  catchFlyPickerOptionActive: { backgroundColor: Colors.background },
  catchFlyPickerOptionText: { fontSize: FontSize.md, color: Colors.text },
  catchFlyPickerOptionTextActive: { color: Colors.primary, fontWeight: '600' },
  catchFlyRadioRow: { flexDirection: 'row', gap: Spacing.lg, marginBottom: Spacing.sm },
  catchFlyRadioOption: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  catchFlyRadioLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  catchFlyRadioLabelActive: { color: Colors.text, fontWeight: '600' },
  addDropperButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    alignSelf: 'flex-start',
  },
  addDropperButtonText: { fontSize: FontSize.sm, color: Colors.primary },
  catchModalInput: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.sm,
  },
  catchModalNoteInput: { minHeight: 64 },
  catchPhotoRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.sm },
  catchPhotoButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catchPhotoButtonLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary },
  catchPhotoPreviewWrap: { position: 'relative', width: 120, height: 120 },
  catchPhotoPreview: { width: 120, height: 120, borderRadius: BorderRadius.md },
  catchPhotoRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  chipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '15',
  },
  chipText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: Colors.primary, fontWeight: '600' },
  catchModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  catchModalCancel: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  catchModalCancelText: { fontSize: FontSize.md, color: Colors.textSecondary, fontWeight: '600' },
  confirmFlyButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    minWidth: 120,
  },
  confirmFlyButtonText: { color: Colors.textInverse, fontSize: FontSize.md, fontWeight: '600' },
});
