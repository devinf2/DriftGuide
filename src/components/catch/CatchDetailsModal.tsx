import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { CatchPinPickerMap } from '@/src/components/map/CatchPinPickerMap';
import { addPhoto, deleteCatchPhotoByUrl, PhotoQueuedOfflineError } from '@/src/services/photoService';
import { upsertCatchEventToCloud } from '@/src/services/sync';
import { fetchHistoricalWeather } from '@/src/services/historicalWeather';
import { tripMapDefaultCenterCoordinate, tripSeedLatLng } from '@/src/utils/mapViewport';
import { upsertEventSorted } from '@/src/utils/journalTimeline';
import { extractPhotoMetadataFromPickerAsset, type PhotoExifMetadata } from '@/src/utils/imageExif';
import { buildEventConditionsSnapshot } from '@/src/utils/eventConditionsSnapshot';
import type {
  CatchData,
  EventConditionsSnapshot,
  Fly,
  FlyCatalog,
  FlyChangeData,
  PresentationMethod,
  Structure,
  Trip,
  TripEvent,
} from '@/src/types';
import { TripFlyPatternPickerModal } from '@/src/components/fly/TripFlyPatternPickerModal';
import { seedSelectionFromFlyChange } from '@/src/components/fly/ChangeFlyPickerModal';
import { normalizeCatchPhotoUrls } from '@/src/utils/catchPhotos';

const MAX_CATCH_PHOTOS = 8;

/** Sentinel for size/color fly dropdowns: set field to null */
const CLEAR_FLY_FIELD = '__clear__';

function isRemoteStorageUrl(uri: string): boolean {
  const t = uri.trim();
  return t.startsWith('http://') || t.startsWith('https://');
}

export type CatchDetailsSubmitAdd = {
  primary: FlyChangeData;
  dropper: FlyChangeData | null;
  catchFields: Partial<CatchData>;
  latitude: number | null;
  longitude: number | null;
  /** Local file URIs from picker (uploaded after catch is saved). */
  photoUris: string[];
  /** EXIF / photo capture time for storage and catch timestamp when present */
  photoCapturedAtIso?: string | null;
  /** Catch event time (usually same as photo when EXIF exists) */
  catchTimestampIso?: string | null;
  /** Historical or explicit snapshot; omit to use live trip conditions in store */
  conditionsSnapshot?: EventConditionsSnapshot | null;
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

export function mergeEditCatchEvents(
  allEvents: TripEvent[],
  editing: TripEvent,
  primary: FlyChangeData,
  dropper: FlyChangeData | null,
  catchData: CatchData,
  latitude: number | null,
  longitude: number | null,
  eventOverrides?: {
    timestamp?: string;
    conditions_snapshot?: EventConditionsSnapshot | null;
  },
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

  const ts =
    eventOverrides?.timestamp != null && !Number.isNaN(Date.parse(eventOverrides.timestamp))
      ? eventOverrides.timestamp
      : editing.timestamp;
  const snap =
    eventOverrides && 'conditions_snapshot' in eventOverrides
      ? eventOverrides.conditions_snapshot
      : editing.conditions_snapshot;

  const nextCatch: TripEvent = {
    ...editing,
    latitude,
    longitude,
    timestamp: ts,
    conditions_snapshot: snap ?? null,
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
  /** Global catalog for “All flies”; when empty, names come from {@link flyPickerNames} / {@link FLY_NAMES}. */
  flyCatalog?: FlyCatalog[];
  allEvents: TripEvent[];
  editingEvent?: TripEvent | null;
  /** Add mode: seed rig from current trip state */
  seedPrimary?: FlyChangeData | null;
  seedDropper?: FlyChangeData | null;
  getPresentationForFly?: (name: string, size: number | null, color: string | null) => PresentationMethod | null;
  onSubmitAdd?: (payload: CatchDetailsSubmitAdd) => Promise<void>;
  onSubmitEdit?: (nextEvents: TripEvent[]) => Promise<void>;
  onPickPhoto?: (source: 'camera' | 'library') => void;
  /** When true, edit submit skips Supabase photo/sync calls (e.g. import-past wizard). */
  deferCloudWrites?: boolean;
  /** Add mode: pre-fill gallery (e.g. import past trips). */
  initialAddPhotoUris?: string[];
  /**
   * Add mode: EXIF aggregate from import photos — seeds map pin and capture time so we don't replace
   * photo GPS with the device's current location.
   */
  importPhotoMetaSeed?: PhotoExifMetadata | null;
};

function createCatchDetailsStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
      backgroundColor: colors.surface,
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
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
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
      color: colors.text,
    },
    coordHint: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
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
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    useGpsButtonPressed: { opacity: 0.75 },
    useGpsButtonText: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.primary,
    },
    coordRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
    coordInput: { flex: 1 },
    exifHint: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: Spacing.sm,
      marginBottom: Spacing.xs,
      lineHeight: 18,
    },
    flyFieldLabel: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
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
      backgroundColor: colors.background,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    catchFlyDropdownRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
      marginBottom: Spacing.sm,
      backgroundColor: colors.background,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    catchFlyDropdownValue: {
      fontSize: FontSize.sm,
      color: colors.text,
      flex: 1,
    },
    catchFlyDropdownPlaceholder: { color: colors.textTertiary },
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
    /** Fly pattern sheet (embedded — avoids a second root Modal eating touches on web / stacked modals) */
    catchPatternPickerOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      zIndex: 60,
      elevation: 60,
    },
    pickerBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    catchFlyPickerSheet: {
      alignSelf: 'stretch',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      maxHeight: '58%',
      marginHorizontal: Spacing.xs,
    },
    searchInput: {
      margin: Spacing.sm,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.md,
      fontSize: FontSize.md,
      color: colors.text,
      backgroundColor: colors.background,
    },
    catchFlyPickerList: { maxHeight: 320 },
    catchFlyPickerOption: {
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    catchFlyPickerOptionActive: { backgroundColor: colors.background },
    catchFlyPickerOptionText: { fontSize: FontSize.md, color: colors.text },
    catchFlyPickerOptionTextActive: { color: colors.primary, fontWeight: '600' },
    /** Radio + “Primary fly” / “Secondary fly” on one row; dropdowns below */
    catchFlyRigHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    catchFlyRigRadioPressable: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 2,
      marginRight: -Spacing.xs,
    },
    flyFieldLabelInline: { marginBottom: 0, flex: 1 },
    addSecondaryFlyButton: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      marginBottom: Spacing.sm,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      borderStyle: 'dashed',
      alignSelf: 'flex-start',
    },
    addSecondaryFlyButtonText: { fontSize: FontSize.sm, color: colors.primary },
    catchModalInput: {
      backgroundColor: colors.background,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: Spacing.sm,
    },
    catchModalNoteInput: { minHeight: 64 },
    catchFlyPatternManualCell: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    catchFlyPatternManualInput: {
      flex: 1,
      fontSize: FontSize.sm,
      color: colors.text,
      paddingVertical: Spacing.xs,
      minWidth: 0,
    },
    catchPhotoActionsRow: {
      flexDirection: 'row',
      gap: Spacing.md,
      marginBottom: Spacing.md,
      alignItems: 'center',
    },
    catchPhotoScroll: {
      marginBottom: Spacing.sm,
      maxHeight: 130,
      width: '100%',
    },
    /** Padding so last thumbnail can scroll past the edge; row must not shrink (horizontal scroll). */
    catchPhotoThumbsContent: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingRight: Spacing.lg,
      gap: Spacing.md,
    },
    catchPhotoButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      backgroundColor: colors.background,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    catchPhotoButtonLabel: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary },
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
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    chipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + '15',
    },
    chipText: { fontSize: FontSize.sm, color: colors.textSecondary, fontWeight: '500' },
    chipTextActive: { color: colors.primary, fontWeight: '600' },
    catchModalActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.xs,
      paddingBottom: Spacing.xs,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    catchModalCancel: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
    catchModalCancelText: { fontSize: FontSize.md, color: colors.textSecondary, fontWeight: '600' },
    confirmFlyButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      minWidth: 120,
    },
    confirmFlyButtonText: { color: colors.textInverse, fontSize: FontSize.md, fontWeight: '600' },
  });
}

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
  flyCatalog: flyCatalogProp = [],
  allEvents,
  editingEvent,
  seedPrimary,
  seedDropper,
  getPresentationForFly,
  onSubmitAdd,
  onSubmitEdit,
  onPickPhoto: onPickPhotoProp,
  deferCloudWrites = false,
  initialAddPhotoUris,
  importPhotoMetaSeed = null,
}: CatchDetailsModalProps) {
  const { colors } = useAppTheme();
  const [catchFlyName, setCatchFlyName] = useState('');
  const [catchFlySize, setCatchFlySize] = useState<number | null>(null);
  const [catchFlyColor, setCatchFlyColor] = useState<string | null>(null);
  const [catchFlyName2, setCatchFlyName2] = useState<string | null>(null);
  const [catchFlySize2, setCatchFlySize2] = useState<number | null>(null);
  const [catchFlyColor2, setCatchFlyColor2] = useState<string | null>(null);
  const [catchSpecies, setCatchSpecies] = useState('');
  /** True after user picks "Other" or when editing a custom species not in the preset list. */
  const [catchSpeciesOther, setCatchSpeciesOther] = useState(false);
  const [catchSize, setCatchSize] = useState('');
  const [catchNote, setCatchNote] = useState('');
  const [catchDepth, setCatchDepth] = useState('');
  const [catchPhotoUris, setCatchPhotoUris] = useState<string[]>([]);
  /** Remote URLs present when edit form opened (for delete-on-remove). */
  const initialEditRemoteUrlsRef = useRef<string[]>([]);
  /** Set when user picks a photo that includes EXIF (library or camera). */
  const [photoExifMeta, setPhotoExifMeta] = useState<PhotoExifMetadata | null>(null);
  const [catchCaughtOnFly, setCatchCaughtOnFly] = useState<'primary' | 'dropper'>('primary');
  const [catchPresentation, setCatchPresentation] = useState<PresentationMethod | null>(null);
  const [catchReleased, setCatchReleased] = useState<boolean | null>(true);
  const [catchStructure, setCatchStructure] = useState<Structure | null>(null);
  const [pinLat, setPinLat] = useState<number | null>(null);
  const [pinLon, setPinLon] = useState<number | null>(null);
  const [latText, setLatText] = useState('');
  const [lonText, setLonText] = useState('');
  const [catchFlyDropdownOpen, setCatchFlyDropdownOpen] = useState<
    null | 'size' | 'color' | 'size2' | 'color2'
  >(null);
  const [flyPatternPickerOpen, setFlyPatternPickerOpen] = useState(false);
  const [flyPatternPickerFor, setFlyPatternPickerFor] = useState<'primary' | 'dropper'>('primary');
  const [primaryUserBoxFlyId, setPrimaryUserBoxFlyId] = useState<string | null>(null);
  const [primaryCatalogFlyId, setPrimaryCatalogFlyId] = useState<string | null>(null);
  const [primaryPatternManual, setPrimaryPatternManual] = useState(false);
  const [dropperUserBoxFlyId, setDropperUserBoxFlyId] = useState<string | null>(null);
  const [dropperCatalogFlyId, setDropperCatalogFlyId] = useState<string | null>(null);
  const [dropperPatternManual, setDropperPatternManual] = useState(false);
  const [catchSpeciesDropdownOpen, setCatchSpeciesDropdownOpen] = useState(false);
  const [catchSpeciesSearch, setCatchSpeciesSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [coordRecenterTick, setCoordRecenterTick] = useState(0);
  /** Until true, map uses `editTargetCatch` coords so we don't flash the previous catch's pin. */
  const [editPinFormSynced, setEditPinFormSynced] = useState(false);
  const [gpsFillBusy, setGpsFillBusy] = useState(false);

  const mapFallbackCenter = useMemo(() => tripMapDefaultCenterCoordinate(trip), [trip]);
  const styles = useMemo(() => createCatchDetailsStyles(colors), [colors]);

  const resolvedFlyCatalog = useMemo((): FlyCatalog[] => {
    if (flyCatalogProp.length > 0) return flyCatalogProp;
    const names = flyPickerNames?.length ? flyPickerNames : FLY_NAMES;
    return names.map((name) => ({
      id: `catalog-fallback:${name}`,
      name,
      type: 'fly',
      photo_url: null,
      presentation: null,
    }));
  }, [flyCatalogProp, flyPickerNames]);

  const userFliesRef = useRef(userFlies);
  userFliesRef.current = userFlies;
  const resolvedFlyCatalogRef = useRef(resolvedFlyCatalog);
  resolvedFlyCatalogRef.current = resolvedFlyCatalog;

  const filteredSpeciesOptions = useMemo(() => {
    const q = catchSpeciesSearch.trim().toLowerCase();
    if (!q) return SPECIES_OPTIONS;
    const filtered = SPECIES_OPTIONS.filter((s) => s.toLowerCase().includes(q));
    return filtered.includes('Other') ? filtered : [...filtered, 'Other'];
  }, [catchSpeciesSearch]);

  /** Prefer the live row from `allEvents` so lat/lon match the store after sync (menu can hold a stale ref). */
  const editTargetCatch = useMemo(() => {
    if (mode !== 'edit' || !editingEvent || editingEvent.event_type !== 'catch') return null;
    return (
      allEvents.find((e) => e.id === editingEvent.id && e.event_type === 'catch') ?? editingEvent
    );
  }, [mode, editingEvent, allEvents]);

  const catchFlyDropdownOptions: { label: string; value: string | number }[] =
    catchFlyDropdownOpen === null
      ? []
      : catchFlyDropdownOpen === 'size' || catchFlyDropdownOpen === 'size2'
        ? [{ label: '—', value: CLEAR_FLY_FIELD }, ...FLY_SIZES.map((s) => ({ label: `#${s}`, value: s }))]
        : [{ label: '—', value: CLEAR_FLY_FIELD }, ...FLY_COLORS.map((c) => ({ label: c, value: c }))];

  const applyPresentationForPattern = useCallback(
    (pattern: string, size: number | null, color: string | null) => {
      if (pattern.trim() && getPresentationForFly) {
        setCatchPresentation(getPresentationForFly(pattern.trim(), size, color));
      } else {
        setCatchPresentation(null);
      }
    },
    [getPresentationForFly],
  );

  const resetFormForAdd = useCallback(() => {
    const p = seedPrimary;
    const d = seedDropper;
    setCatchFlyName(p?.pattern ?? '');
    setCatchFlySize(p?.size ?? null);
    setCatchFlyColor(p?.color ?? null);
    const ps = seedSelectionFromFlyChange(p ?? null, userFliesRef.current, resolvedFlyCatalogRef.current);
    setPrimaryUserBoxFlyId(ps.userBoxId);
    setPrimaryCatalogFlyId(ps.catalogFlyId);
    setPrimaryPatternManual(ps.manual);
    setCatchFlyName2(d?.pattern ?? null);
    setCatchFlySize2(d?.size ?? null);
    setCatchFlyColor2(d?.color ?? null);
    const ds = seedSelectionFromFlyChange(d ?? null, userFliesRef.current, resolvedFlyCatalogRef.current);
    setDropperUserBoxFlyId(ds.userBoxId);
    setDropperCatalogFlyId(ds.catalogFlyId);
    setDropperPatternManual(ds.manual);
    setCatchSpecies('');
    setCatchSpeciesOther(false);
    setCatchSize('');
    setCatchNote('');
    setCatchDepth('');
    setCatchPhotoUris([]);
    initialEditRemoteUrlsRef.current = [];
    setPhotoExifMeta(null);
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
    setFlyPatternPickerOpen(false);
  }, [seedPrimary, seedDropper, getPresentationForFly]);

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
      const primarySeed: FlyChangeData | null = fd
        ? {
            pattern: fd.pattern ?? '',
            size: fd.size ?? null,
            color: fd.color ?? null,
            fly_id: fd.fly_id,
            fly_color_id: fd.fly_color_id,
            fly_size_id: fd.fly_size_id,
          }
        : null;
      const ps = seedSelectionFromFlyChange(primarySeed, userFlies, resolvedFlyCatalog);
      setPrimaryUserBoxFlyId(ps.userBoxId);
      setPrimaryCatalogFlyId(ps.catalogFlyId);
      setPrimaryPatternManual(ps.manual);
      if (fd?.pattern2) {
        setCatchFlyName2(fd.pattern2);
        setCatchFlySize2(fd.size2 ?? null);
        setCatchFlyColor2(fd.color2 ?? null);
        const dropperSeed: FlyChangeData = {
          pattern: fd.pattern2,
          size: fd.size2 ?? null,
          color: fd.color2 ?? null,
          fly_id: fd.fly_id2,
          fly_color_id: fd.fly_color_id2,
          fly_size_id: fd.fly_size_id2,
        };
        const ds = seedSelectionFromFlyChange(dropperSeed, userFlies, resolvedFlyCatalog);
        setDropperUserBoxFlyId(ds.userBoxId);
        setDropperCatalogFlyId(ds.catalogFlyId);
        setDropperPatternManual(ds.manual);
      } else {
        setCatchFlyName2(null);
        setCatchFlySize2(null);
        setCatchFlyColor2(null);
        setDropperUserBoxFlyId(null);
        setDropperCatalogFlyId(null);
        setDropperPatternManual(false);
      }
      const speciesStr = data.species ?? '';
      setCatchSpecies(speciesStr);
      const presetSpecies = SPECIES_OPTIONS.slice(0, -1);
      setCatchSpeciesOther(Boolean(speciesStr.trim() && !presetSpecies.includes(speciesStr)));
      setCatchSize(data.size_inches != null ? String(data.size_inches) : '');
      setCatchNote(data.note ?? '');
      setCatchDepth(data.depth_ft != null ? String(data.depth_ft) : '');
      setCatchPhotoUris(normalizeCatchPhotoUrls(data));
      initialEditRemoteUrlsRef.current = normalizeCatchPhotoUrls(data).filter(isRemoteStorageUrl);
      setPhotoExifMeta(null);
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
    [allEvents, userFlies, resolvedFlyCatalog],
  );

  /** Edit: load before paint so lat/lon fields and map show the catch immediately (avoids empty fields until interaction). */
  useLayoutEffect(() => {
    if (!visible || mode !== 'edit' || !editTargetCatch) return;
    loadFormForEdit(editTargetCatch);
  }, [
    visible,
    mode,
    editTargetCatch?.id,
    editTargetCatch?.latitude,
    editTargetCatch?.longitude,
    loadFormForEdit,
  ]);

  useEffect(() => {
    if (!visible) setEditPinFormSynced(false);
  }, [visible]);

  useEffect(() => {
    if (catchSpeciesDropdownOpen) setCatchSpeciesSearch('');
  }, [catchSpeciesDropdownOpen]);

  useEffect(() => {
    if (!visible || mode !== 'add') return;
    resetFormForAdd();
    if (initialAddPhotoUris && initialAddPhotoUris.length > 0) {
      setCatchPhotoUris([...initialAddPhotoUris]);
    }
    const seed = importPhotoMetaSeed;
    const seedGpsOk =
      seed != null &&
      seed.latitude != null &&
      seed.longitude != null &&
      Number.isFinite(seed.latitude) &&
      Number.isFinite(seed.longitude);
    const seedTimeOk = seed?.takenAt != null && !Number.isNaN(seed.takenAt.getTime());
    if (seed != null && (seedGpsOk || seedTimeOk)) {
      setPhotoExifMeta({
        takenAt: seedTimeOk ? seed!.takenAt : null,
        latitude: seed!.latitude,
        longitude: seed!.longitude,
      });
    }
    if (seedGpsOk) {
      setPinLat(seed!.latitude);
      setPinLon(seed!.longitude);
      setLatText(String(seed!.latitude));
      setLonText(String(seed!.longitude));
      return;
    }

    let cancelled = false;
    const applyPin = (lat: number, lon: number) => {
      if (cancelled) return;
      setPinLat(lat);
      setPinLon(lon);
      setLatText(String(lat));
      setLonText(String(lon));
    };

    (async () => {
      let filled = false;
      try {
        const { status } = await ExpoLocation.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const last = await ExpoLocation.getLastKnownPositionAsync({
            maxAge: 1000 * 60 * 60 * 24,
          });
          if (last?.coords) {
            const la = last.coords.latitude;
            const lo = last.coords.longitude;
            if (Number.isFinite(la) && Number.isFinite(lo)) {
              applyPin(la, lo);
              filled = true;
            }
          }
          try {
            const loc = await ExpoLocation.getCurrentPositionAsync({
              accuracy: ExpoLocation.Accuracy.Low,
            });
            const la = loc.coords.latitude;
            const lo = loc.coords.longitude;
            if (Number.isFinite(la) && Number.isFinite(lo)) {
              applyPin(la, lo);
              filled = true;
            }
          } catch {
            /* No fresh fix (common offline); keep last-known or fall through to trip. */
          }
        }
      } catch {
        /* optional */
      }

      if (cancelled) return;
      if (!filled) {
        const tripSeed = tripSeedLatLng(trip);
        if (tripSeed) {
          applyPin(tripSeed.latitude, tripSeed.longitude);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, mode, resetFormForAdd, initialAddPhotoUris, importPhotoMetaSeed, trip]);

  useEffect(() => {
    if (!visible || mode !== 'add' || !catchFlyName?.trim() || !getPresentationForFly) return;
    setCatchPresentation(getPresentationForFly(catchFlyName, catchFlySize, catchFlyColor));
  }, [visible, mode, catchFlyName, catchFlySize, catchFlyColor, getPresentationForFly]);

  useEffect(() => {
    setCoordRecenterTick(0);
  }, [editTargetCatch?.id]);

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
    mode === 'edit' && editTargetCatch && !editPinFormSynced
      ? editTargetCatch.latitude ?? null
      : pinLat;
  const mapDisplayLon =
    mode === 'edit' && editTargetCatch && !editPinFormSynced
      ? editTargetCatch.longitude ?? null
      : pinLon;

  const handleCatchFlyDropdownSelect = (value: string | number) => {
    if (value === CLEAR_FLY_FIELD) {
      if (catchFlyDropdownOpen === 'size') setCatchFlySize(null);
      else if (catchFlyDropdownOpen === 'color') setCatchFlyColor(null);
      else if (catchFlyDropdownOpen === 'size2') setCatchFlySize2(null);
      else if (catchFlyDropdownOpen === 'color2') setCatchFlyColor2(null);
    } else if (catchFlyDropdownOpen === 'size') setCatchFlySize(value as number);
    else if (catchFlyDropdownOpen === 'color') setCatchFlyColor(String(value));
    else if (catchFlyDropdownOpen === 'size2') setCatchFlySize2(value as number);
    else if (catchFlyDropdownOpen === 'color2') setCatchFlyColor2(String(value));
    setCatchFlyDropdownOpen(null);
  };

  const openFlyPatternPicker = useCallback((which: 'primary' | 'dropper') => {
    Keyboard.dismiss();
    setCatchFlyDropdownOpen(null);
    setCatchSpeciesDropdownOpen(false);
    setFlyPatternPickerFor(which);
    setFlyPatternPickerOpen(true);
  }, []);

  const applyPhotoExifToPin = useCallback((meta: PhotoExifMetadata) => {
    if (meta.latitude != null && meta.longitude != null) {
      setPinLat(meta.latitude);
      setPinLon(meta.longitude);
      setLatText(String(meta.latitude));
      setLonText(String(meta.longitude));
      setEditPinFormSynced(true);
      setCoordRecenterTick((t) => t + 1);
    }
  }, []);

  const pickPhotoInternal = async (source: 'camera' | 'library') => {
    if (onPickPhotoProp) {
      onPickPhotoProp(source);
      return;
    }
    if (catchPhotoUris.length >= MAX_CATCH_PHOTOS) {
      Alert.alert('Limit reached', `You can add up to ${MAX_CATCH_PHOTOS} photos per catch.`);
      return;
    }
    const pickerOpts = { allowsEditing: false, quality: 0.85 as const, exif: true };
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync(pickerOpts);
      const asset = result.assets?.[0];
      if (!result.canceled && asset?.uri) {
        const meta = extractPhotoMetadataFromPickerAsset(asset);
        const hasMeta =
          meta.takenAt != null || meta.latitude != null || meta.longitude != null;
        setPhotoExifMeta(hasMeta ? meta : null);
        setCatchPhotoUris((prev) => [...prev, asset.uri]);
        applyPhotoExifToPin(meta);
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo library access to choose photos.');
        return;
      }
      const remaining = MAX_CATCH_PHOTOS - catchPhotoUris.length;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
        exif: true,
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, remaining),
      });
      if (result.canceled || !result.assets?.length) return;
      const toAdd = result.assets
        .map((a) => a.uri)
        .filter((uri): uri is string => Boolean(uri))
        .slice(0, remaining);
      if (toAdd.length === 0) return;
      setCatchPhotoUris((prev) => [...prev, ...toAdd]);
      let appliedExif = false;
      for (const asset of result.assets) {
        if (!asset.uri) continue;
        const meta = extractPhotoMetadataFromPickerAsset(asset);
        const hasMeta =
          meta.takenAt != null || meta.latitude != null || meta.longitude != null;
        if (hasMeta) {
          setPhotoExifMeta(meta);
          applyPhotoExifToPin(meta);
          appliedExif = true;
          break;
        }
      }
      if (!appliedExif && toAdd.length > 0) {
        setPhotoExifMeta(null);
      }
    }
  };

  const resolvePrimaryDropper = (): { primary: FlyChangeData; dropper: FlyChangeData | null } => {
    const primaryName = catchFlyName.trim();
    let primary: FlyChangeData;
    if (!primaryName) {
      primary = {
        pattern: '',
        size: catchFlySize ?? null,
        color: catchFlyColor ?? null,
      };
    } else if (primaryUserBoxFlyId) {
      const uf = userFlies.find((f) => f.id === primaryUserBoxFlyId);
      if (uf) {
        primary = {
          pattern: uf.name,
          size: uf.size ?? null,
          color: uf.color ?? null,
          fly_id: uf.fly_id ?? undefined,
          fly_color_id: uf.fly_color_id ?? undefined,
          fly_size_id: uf.fly_size_id ?? undefined,
        };
      } else {
        const matchPrimary = userFlies.find(
          (f) =>
            f.name === primaryName &&
            (f.size ?? null) === (catchFlySize ?? null) &&
            (f.color ?? null) === (catchFlyColor ?? null),
        );
        primary = {
          pattern: primaryName,
          size: catchFlySize ?? null,
          color: catchFlyColor ?? null,
          fly_id: matchPrimary?.fly_id ?? primaryCatalogFlyId ?? undefined,
          fly_color_id: matchPrimary?.fly_color_id,
          fly_size_id: matchPrimary?.fly_size_id,
        };
      }
    } else if (primaryCatalogFlyId) {
      primary = {
        pattern: primaryName,
        size: catchFlySize ?? null,
        color: catchFlyColor ?? null,
        fly_id: primaryCatalogFlyId,
      };
    } else {
      const matchPrimary = userFlies.find(
        (f) =>
          f.name === primaryName &&
          (f.size ?? null) === (catchFlySize ?? null) &&
          (f.color ?? null) === (catchFlyColor ?? null),
      );
      primary = {
        pattern: primaryName,
        size: catchFlySize ?? null,
        color: catchFlyColor ?? null,
        fly_id: matchPrimary?.fly_id,
        fly_color_id: matchPrimary?.fly_color_id,
        fly_size_id: matchPrimary?.fly_size_id,
      };
    }

    let dropper: FlyChangeData | null = null;
    if (catchFlyName2 != null && catchFlyName2.trim()) {
      if (dropperUserBoxFlyId) {
        const uf2 = userFlies.find((f) => f.id === dropperUserBoxFlyId);
        if (uf2) {
          dropper = {
            pattern: uf2.name,
            size: uf2.size ?? null,
            color: uf2.color ?? null,
            fly_id: uf2.fly_id ?? undefined,
            fly_color_id: uf2.fly_color_id ?? undefined,
            fly_size_id: uf2.fly_size_id ?? undefined,
          };
        } else {
          const match2 = userFlies.find(
            (f) =>
              f.name === catchFlyName2.trim() &&
              (f.size ?? null) === (catchFlySize2 ?? null) &&
              (f.color ?? null) === (catchFlyColor2 ?? null),
          );
          dropper = {
            pattern: catchFlyName2.trim(),
            size: catchFlySize2 ?? null,
            color: catchFlyColor2 ?? null,
            fly_id: match2?.fly_id ?? dropperCatalogFlyId ?? undefined,
            fly_color_id: match2?.fly_color_id,
            fly_size_id: match2?.fly_size_id,
          };
        }
      } else if (dropperCatalogFlyId) {
        dropper = {
          pattern: catchFlyName2.trim(),
          size: catchFlySize2 ?? null,
          color: catchFlyColor2 ?? null,
          fly_id: dropperCatalogFlyId,
        };
      } else {
        const match2 = userFlies.find(
          (f) =>
            f.name === catchFlyName2.trim() &&
            (f.size ?? null) === (catchFlySize2 ?? null) &&
            (f.color ?? null) === (catchFlyColor2 ?? null),
        );
        dropper = {
          pattern: catchFlyName2.trim(),
          size: catchFlySize2 ?? null,
          color: catchFlyColor2 ?? null,
          fly_id: match2?.fly_id,
          fly_color_id: match2?.fly_color_id,
          fly_size_id: match2?.fly_size_id,
        };
      }
    }

    return { primary, dropper };
  };

  const handleSubmit = async () => {
    const { primary, dropper } = resolvePrimaryDropper();
    const species = catchSpecies.trim() || null;
    const sizeNum = catchSize.trim() ? parseFloat(catchSize.trim()) : null;
    const depthNum = catchDepth.trim() ? parseFloat(catchDepth.trim()) : null;
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

        let catchTimestampIso: string | null = null;
        let photoCapturedAtIso: string | null = null;
        if (photoExifMeta?.takenAt) {
          catchTimestampIso = photoExifMeta.takenAt.toISOString();
          photoCapturedAtIso = catchTimestampIso;
        }

        let conditionsSnapshot: EventConditionsSnapshot | null | undefined = undefined;
        if (photoExifMeta?.takenAt != null && lat != null && lon != null) {
          const hist = await fetchHistoricalWeather(lat, lon, photoExifMeta.takenAt);
          conditionsSnapshot = hist
            ? buildEventConditionsSnapshot(hist, null, photoExifMeta.takenAt)
            : null;
        }

        await onSubmitAdd({
          primary,
          dropper,
          catchFields: {
            species: species ?? undefined,
            size_inches: sizeNum ?? undefined,
            note: catchNote.trim() || undefined,
            caught_on_fly: catchCaughtOnFly,
            quantity: 1,
            depth_ft: depthNum ?? undefined,
            presentation_method: catchPresentation ?? undefined,
            released: catchReleased ?? undefined,
            structure: catchStructure ?? undefined,
          },
          latitude: lat,
          longitude: lon,
          photoUris: [...catchPhotoUris],
          photoCapturedAtIso,
          catchTimestampIso,
          conditionsSnapshot,
        });
        onClose();
      } else if (mode === 'edit' && editingEvent && onSubmitEdit) {
        const targetCatch = editTargetCatch ?? editingEvent;
        const newLocalUris = catchPhotoUris.filter((u) => !isRemoteStorageUrl(u));
        if (!deferCloudWrites && newLocalUris.length > 0 && !isConnected) {
          Alert.alert('Offline', 'Connect to the internet to add new photos.');
          setSubmitting(false);
          return;
        }

        let finalUrls: string[];

        if (deferCloudWrites) {
          finalUrls = [...catchPhotoUris];
        } else {
          for (const u of initialEditRemoteUrlsRef.current) {
            if (!catchPhotoUris.includes(u)) {
              try {
                await deleteCatchPhotoByUrl(userId, targetCatch.id, u);
              } catch (e) {
                console.warn('[CatchDetailsModal] deleteCatchPhotoByUrl', e);
              }
            }
          }

          if (newLocalUris.length > 0) {
            const syncOk = await upsertCatchEventToCloud(trip, targetCatch, allEvents);
            if (!syncOk) {
              Alert.alert('Sync failed', 'Could not save the catch before uploading photos. Try again.');
              setSubmitting(false);
              return;
            }
          }

          finalUrls = [];
          try {
            for (const u of catchPhotoUris) {
              if (isRemoteStorageUrl(u)) {
                finalUrls.push(u);
                continue;
              }
              const useDropper = catchCaughtOnFly === 'dropper' && dropper?.pattern?.trim();
              const p = await addPhoto(
                {
                  userId,
                  tripId: trip.id,
                  uri: u,
                  caption: catchNote.trim() || undefined,
                  species: species ?? undefined,
                  fly_pattern: (useDropper ? dropper!.pattern : primary.pattern) || undefined,
                  fly_size: (useDropper ? dropper!.size : primary.size) ?? undefined,
                  fly_color: (useDropper ? dropper!.color : primary.color) ?? undefined,
                  fly_id: useDropper ? dropper!.fly_id : primary.fly_id,
                  captured_at: photoExifMeta?.takenAt?.toISOString() ?? targetCatch.timestamp,
                  catchId: targetCatch.id,
                  displayOrder: finalUrls.length,
                },
                { isOnline: true },
              );
              finalUrls.push(p.url);
            }
          } catch (e) {
            if (e instanceof PhotoQueuedOfflineError) Alert.alert('Offline', e.message);
            else Alert.alert('Photo', (e as Error).message);
            setSubmitting(false);
            return;
          }
        }

        const priorCatch = targetCatch.data as CatchData;
        const quantityPreserved =
          priorCatch.quantity != null && Number.isFinite(priorCatch.quantity)
            ? Math.max(1, Math.floor(priorCatch.quantity))
            : 1;

        const catchData: CatchData = {
          species,
          size_inches: sizeNum != null && Number.isFinite(sizeNum) ? sizeNum : null,
          note: catchNote.trim() || null,
          photo_url: finalUrls[0] ?? null,
          photo_urls: finalUrls.length ? finalUrls : null,
          active_fly_event_id: priorCatch.active_fly_event_id,
          caught_on_fly: catchCaughtOnFly,
          quantity: quantityPreserved,
          depth_ft: depthNum != null && Number.isFinite(depthNum) ? depthNum : null,
          presentation_method: catchPresentation,
          released: catchReleased,
          structure: catchStructure,
        };

        let eventOverrides:
          | { timestamp?: string; conditions_snapshot?: EventConditionsSnapshot | null }
          | undefined;
        const addedLocalPhoto = newLocalUris.length > 0;
        if (addedLocalPhoto && photoExifMeta?.takenAt) {
          if (lat != null && lon != null) {
            const hist = await fetchHistoricalWeather(lat, lon, photoExifMeta.takenAt);
            eventOverrides = {
              timestamp: photoExifMeta.takenAt.toISOString(),
              conditions_snapshot: hist
                ? buildEventConditionsSnapshot(hist, null, photoExifMeta.takenAt)
                : null,
            };
          } else {
            eventOverrides = { timestamp: photoExifMeta.takenAt.toISOString() };
          }
        }

        const nextEvents = mergeEditCatchEvents(
          allEvents,
          targetCatch,
          primary,
          dropper,
          catchData,
          lat,
          lon,
          eventOverrides,
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
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.useGpsButtonText}>Use current location</Text>
          )}
        </Pressable>
      </View>
      <View style={styles.coordRow}>
        <TextInput
          style={[styles.catchModalInput, styles.coordInput]}
          placeholder="Latitude"
          placeholderTextColor={colors.textTertiary}
          value={latText}
          onChangeText={setLatText}
          onBlur={syncPinFromText}
          keyboardType="numbers-and-punctuation"
        />
        <TextInput
          style={[styles.catchModalInput, styles.coordInput]}
          placeholder="Longitude"
          placeholderTextColor={colors.textTertiary}
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
          <View style={styles.catchModal}>
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
                  <MaterialIcons name="close" size={24} color={colors.text} />
                </Pressable>
              ) : null}
            </View>
            <ScrollView
              style={styles.catchModalScroll}
              contentContainerStyle={styles.catchModalScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              nestedScrollEnabled
            >
              {catchFlyName2 != null ? (
                <>
                  <Text style={styles.flyFieldLabel}>Caught on</Text>
                  <View style={styles.catchFlyRigHeaderRow}>
                    <Pressable
                      style={styles.catchFlyRigRadioPressable}
                      onPress={() => setCatchCaughtOnFly('primary')}
                      hitSlop={8}
                      accessibilityRole="radio"
                      accessibilityLabel="Fish caught on primary fly"
                      accessibilityState={{ selected: catchCaughtOnFly === 'primary' }}
                    >
                      <MaterialIcons
                        name={catchCaughtOnFly === 'primary' ? 'radio-button-checked' : 'radio-button-unchecked'}
                        size={22}
                        color={catchCaughtOnFly === 'primary' ? colors.primary : colors.textSecondary}
                      />
                    </Pressable>
                    <Text style={[styles.flyFieldLabel, styles.flyFieldLabelInline]}>Primary fly</Text>
                  </View>
                </>
              ) : (
                <Text style={styles.flyFieldLabel}>Fly</Text>
              )}
              <View style={styles.catchFlyDropdownRowWrap}>
                {primaryPatternManual ? (
                  <View style={[styles.catchFlyDropdownCell, styles.catchFlyPatternManualCell]}>
                    <TextInput
                      style={styles.catchFlyPatternManualInput}
                      placeholder="Pattern name"
                      placeholderTextColor={colors.textTertiary}
                      value={catchFlyName}
                      onChangeText={setCatchFlyName}
                      autoCorrect={false}
                    />
                    <Pressable
                      onPress={() => openFlyPatternPicker('primary')}
                      hitSlop={8}
                      accessibilityLabel="Browse fly patterns"
                    >
                      <MaterialIcons name="list" size={22} color={colors.primary} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={styles.catchFlyDropdownCell}
                    onPress={() => openFlyPatternPicker('primary')}
                  >
                    <Text
                      style={[
                        styles.catchFlyDropdownValue,
                        !catchFlyName.trim() && styles.catchFlyDropdownPlaceholder,
                      ]}
                      numberOfLines={1}
                    >
                      {catchFlyName.trim() ? catchFlyName : '—'}
                    </Text>
                    <MaterialIcons name="keyboard-arrow-down" size={16} color={colors.textSecondary} />
                  </Pressable>
                )}
                <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('size')}>
                  <Text
                    style={[
                      styles.catchFlyDropdownValue,
                      catchFlySize == null && styles.catchFlyDropdownPlaceholder,
                    ]}
                    numberOfLines={1}
                  >
                    {catchFlySize != null ? `#${catchFlySize}` : '—'}
                  </Text>
                  <MaterialIcons name="keyboard-arrow-down" size={16} color={colors.textSecondary} />
                </Pressable>
                <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('color')}>
                  <Text
                    style={[
                      styles.catchFlyDropdownValue,
                      !catchFlyColor && styles.catchFlyDropdownPlaceholder,
                    ]}
                    numberOfLines={1}
                  >
                    {catchFlyColor || '—'}
                  </Text>
                  <MaterialIcons name="keyboard-arrow-down" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>

              {catchFlyName2 != null ? (
                <>
                  <View style={[styles.catchFlyRigHeaderRow, { marginTop: Spacing.md }]}>
                    <Pressable
                      style={styles.catchFlyRigRadioPressable}
                      onPress={() => setCatchCaughtOnFly('dropper')}
                      hitSlop={8}
                      accessibilityRole="radio"
                      accessibilityLabel="Fish caught on secondary fly"
                      accessibilityState={{ selected: catchCaughtOnFly === 'dropper' }}
                    >
                      <MaterialIcons
                        name={catchCaughtOnFly === 'dropper' ? 'radio-button-checked' : 'radio-button-unchecked'}
                        size={22}
                        color={catchCaughtOnFly === 'dropper' ? colors.primary : colors.textSecondary}
                      />
                    </Pressable>
                    <Text style={[styles.flyFieldLabel, styles.flyFieldLabelInline]}>Secondary fly</Text>
                  </View>
                  <View style={styles.catchFlyDropdownRowWrap}>
                    {dropperPatternManual ? (
                      <View style={[styles.catchFlyDropdownCell, styles.catchFlyPatternManualCell]}>
                        <TextInput
                          style={styles.catchFlyPatternManualInput}
                          placeholder="Pattern name"
                          placeholderTextColor={colors.textTertiary}
                          value={catchFlyName2}
                          onChangeText={setCatchFlyName2}
                          autoCorrect={false}
                        />
                        <Pressable
                          onPress={() => openFlyPatternPicker('dropper')}
                          hitSlop={8}
                          accessibilityLabel="Browse secondary fly patterns"
                        >
                          <MaterialIcons name="list" size={22} color={colors.primary} />
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        style={styles.catchFlyDropdownCell}
                        onPress={() => openFlyPatternPicker('dropper')}
                      >
                        <Text
                          style={[
                            styles.catchFlyDropdownValue,
                            !(catchFlyName2 ?? '').trim() && styles.catchFlyDropdownPlaceholder,
                          ]}
                          numberOfLines={1}
                        >
                          {(catchFlyName2 ?? '').trim() ? catchFlyName2 : '—'}
                        </Text>
                        <MaterialIcons name="keyboard-arrow-down" size={16} color={colors.textSecondary} />
                      </Pressable>
                    )}
                    <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('size2')}>
                      <Text
                        style={[
                          styles.catchFlyDropdownValue,
                          catchFlySize2 == null && styles.catchFlyDropdownPlaceholder,
                        ]}
                        numberOfLines={1}
                      >
                        {catchFlySize2 != null ? `#${catchFlySize2}` : '—'}
                      </Text>
                      <MaterialIcons name="keyboard-arrow-down" size={16} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('color2')}>
                      <Text
                        style={[
                          styles.catchFlyDropdownValue,
                          !catchFlyColor2 && styles.catchFlyDropdownPlaceholder,
                        ]}
                        numberOfLines={1}
                      >
                        {catchFlyColor2 || '—'}
                      </Text>
                      <MaterialIcons name="keyboard-arrow-down" size={16} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                  <Pressable
                    style={[styles.addSecondaryFlyButton, { marginTop: Spacing.sm }]}
                    onPress={() => {
                      setCatchFlyName2(null);
                      setCatchFlySize2(null);
                      setCatchFlyColor2(null);
                      setDropperUserBoxFlyId(null);
                      setDropperCatalogFlyId(null);
                      setDropperPatternManual(false);
                      setCatchCaughtOnFly('primary');
                    }}
                  >
                    <Text style={styles.addSecondaryFlyButtonText}>Remove secondary fly</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  style={styles.addSecondaryFlyButton}
                  onPress={() => {
                    setCatchFlyName2('');
                    setCatchFlySize2(null);
                    setCatchFlyColor2(null);
                    setDropperUserBoxFlyId(null);
                    setDropperCatalogFlyId(null);
                    setDropperPatternManual(false);
                  }}
                >
                  <Text style={styles.addSecondaryFlyButtonText}>Add secondary fly</Text>
                </Pressable>
              )}

              <Text style={styles.flyFieldLabel}>Photos</Text>
              {catchPhotoUris.length < MAX_CATCH_PHOTOS ? (
                <View style={styles.catchPhotoActionsRow}>
                  <Pressable style={styles.catchPhotoButton} onPress={() => void pickPhotoInternal('camera')}>
                    <MaterialIcons name="photo-camera" size={22} color={colors.primary} />
                    <Text style={styles.catchPhotoButtonLabel}>Camera</Text>
                  </Pressable>
                  <Pressable style={styles.catchPhotoButton} onPress={() => void pickPhotoInternal('library')}>
                    <MaterialIcons name="photo-library" size={22} color={colors.primary} />
                    <Text style={styles.catchPhotoButtonLabel}>Upload</Text>
                  </Pressable>
                </View>
              ) : null}
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator
                directionalLockEnabled
                style={styles.catchPhotoScroll}
                contentContainerStyle={styles.catchPhotoThumbsContent}
              >
                {catchPhotoUris.map((uri, idx) => (
                  <View key={`${uri}-${idx}`} style={styles.catchPhotoPreviewWrap}>
                    <Image source={{ uri }} style={styles.catchPhotoPreview} />
                    <Pressable
                      style={styles.catchPhotoRemove}
                      onPress={() => {
                        setCatchPhotoUris((prev) => prev.filter((_, i) => i !== idx));
                        setPhotoExifMeta(null);
                      }}
                    >
                      <MaterialIcons name="close" size={18} color={colors.textInverse} />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
              {photoExifMeta?.takenAt ? (
                <Text style={styles.exifHint}>
                  Using date and time from the photo
                  {photoExifMeta.latitude != null && photoExifMeta.longitude != null
                    ? '; map pin from photo location when available'
                    : ''}
                  . Weather is filled from historical data when coordinates are set.
                </Text>
              ) : null}

              <Text style={styles.flyFieldLabel}>Size (inches)</Text>
              <TextInput
                style={styles.catchModalInput}
                placeholder="e.g. 14"
                placeholderTextColor={colors.textTertiary}
                value={catchSize}
                onChangeText={setCatchSize}
                keyboardType="decimal-pad"
              />
              <Text style={styles.flyFieldLabel}>Species</Text>
              <Pressable style={styles.catchFlyDropdownRow} onPress={() => setCatchSpeciesDropdownOpen(true)}>
                <Text
                  style={[
                    styles.catchFlyDropdownValue,
                    !catchSpecies && !catchSpeciesOther && styles.catchFlyDropdownPlaceholder,
                  ]}
                  numberOfLines={1}
                >
                  {catchSpeciesOther
                    ? catchSpecies.trim() || 'Other'
                    : catchSpecies || 'Select species'}
                </Text>
                <MaterialIcons name="keyboard-arrow-down" size={16} color={colors.textSecondary} />
              </Pressable>
              {catchSpeciesOther ? (
                <TextInput
                  style={styles.catchModalInput}
                  placeholder="Species name"
                  placeholderTextColor={colors.textTertiary}
                  value={catchSpecies}
                  onChangeText={setCatchSpecies}
                />
              ) : null}
              <Text style={styles.flyFieldLabel}>Notes</Text>
              <TextInput
                style={[styles.catchModalInput, styles.catchModalNoteInput]}
                placeholder="Optional note"
                placeholderTextColor={colors.textTertiary}
                value={catchNote}
                onChangeText={setCatchNote}
                multiline
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
              <Text style={styles.flyFieldLabel}>Catch Depth</Text>
              <TextInput
                style={styles.catchModalInput}
                placeholder="e.g. 3"
                placeholderTextColor={colors.textTertiary}
                value={catchDepth}
                onChangeText={setCatchDepth}
                keyboardType="decimal-pad"
              />

              {mode === 'add' ? (
                <>
                  <Text style={[styles.flyFieldLabel, { marginTop: Spacing.lg }]}>Catch location</Text>
                  <CatchPinPickerMap
                    latitude={pinLat}
                    longitude={pinLon}
                    onCoordinateChange={onCoordinateChange}
                    height={220}
                    mapFallbackCenter={mapFallbackCenter}
                  />
                  {latLonFineTune}
                </>
              ) : null}

              {mode === 'edit' ? (
                <>
                  <Text style={[styles.flyFieldLabel, { marginTop: Spacing.lg }]}>Catch location</Text>
                  <CatchPinPickerMap
                    latitude={mapDisplayLat}
                    longitude={mapDisplayLon}
                    onCoordinateChange={onCoordinateChange}
                    height={220}
                    interactionMode="pan_center"
                    focusRequestKey={`${editTargetCatch?.id ?? editingEvent?.id ?? 'edit'}-${coordRecenterTick}`}
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
                  <ScrollView style={styles.catchFlyPickerList} keyboardShouldPersistTaps="handled">
                    {catchFlyDropdownOptions.map((opt) => {
                      const isSelected =
                        (catchFlyDropdownOpen === 'size' &&
                          (opt.value === CLEAR_FLY_FIELD
                            ? catchFlySize == null
                            : opt.value === catchFlySize)) ||
                        (catchFlyDropdownOpen === 'color' &&
                          (opt.value === CLEAR_FLY_FIELD
                            ? catchFlyColor == null
                            : opt.value === catchFlyColor)) ||
                        (catchFlyDropdownOpen === 'size2' &&
                          (opt.value === CLEAR_FLY_FIELD
                            ? catchFlySize2 == null
                            : opt.value === catchFlySize2)) ||
                        (catchFlyDropdownOpen === 'color2' &&
                          (opt.value === CLEAR_FLY_FIELD
                            ? catchFlyColor2 == null
                            : opt.value === catchFlyColor2));
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
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search species…"
                    placeholderTextColor={colors.textTertiary}
                    value={catchSpeciesSearch}
                    onChangeText={setCatchSpeciesSearch}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  <ScrollView style={styles.catchFlyPickerList} keyboardShouldPersistTaps="handled">
                    {filteredSpeciesOptions.map((species) => {
                      const isOther = species === 'Other';
                      const isSelected = isOther
                        ? catchSpeciesOther
                        : !catchSpeciesOther && catchSpecies === species;
                      return (
                        <Pressable
                          key={species}
                          style={[styles.catchFlyPickerOption, isSelected && styles.catchFlyPickerOptionActive]}
                          onPress={() => {
                            if (isOther) {
                              setCatchSpecies('');
                              setCatchSpeciesOther(true);
                            } else {
                              setCatchSpecies(species);
                              setCatchSpeciesOther(false);
                            }
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
                  setCatchPhotoUris([]);
                  setPhotoExifMeta(null);
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
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.confirmFlyButtonText}>{mode === 'add' ? 'Add fish' : 'Save'}</Text>
                )}
              </Pressable>
            </View>

            {flyPatternPickerOpen ? (
              <View style={styles.catchPatternPickerOverlay} pointerEvents="box-none">
                <TripFlyPatternPickerModal
                  presentation="embedded"
                  visible
                  onRequestClose={() => setFlyPatternPickerOpen(false)}
                  userFlies={userFlies}
                  catalog={resolvedFlyCatalog}
                  title={flyPatternPickerFor === 'primary' ? 'Select pattern' : 'Select secondary pattern'}
                  searchPlaceholder="Search patterns…"
                  showNoPatternRow
                  noPatternRowActive={
                    flyPatternPickerFor === 'primary'
                      ? !catchFlyName.trim() &&
                        primaryUserBoxFlyId == null &&
                        primaryCatalogFlyId == null &&
                        !primaryPatternManual
                      : !(catchFlyName2 ?? '').trim() &&
                        dropperUserBoxFlyId == null &&
                        dropperCatalogFlyId == null &&
                        !dropperPatternManual
                  }
                  onSelectNoPattern={() => {
                    if (flyPatternPickerFor === 'primary') {
                      setCatchFlyName('');
                      setCatchFlySize(null);
                      setCatchFlyColor(null);
                      setPrimaryUserBoxFlyId(null);
                      setPrimaryCatalogFlyId(null);
                      setPrimaryPatternManual(false);
                      setCatchPresentation(null);
                    } else {
                      setCatchFlyName2('');
                      setCatchFlySize2(null);
                      setCatchFlyColor2(null);
                      setDropperUserBoxFlyId(null);
                      setDropperCatalogFlyId(null);
                      setDropperPatternManual(false);
                    }
                  }}
                  selectedUserBoxFlyId={
                    flyPatternPickerFor === 'primary' ? primaryUserBoxFlyId : dropperUserBoxFlyId
                  }
                  selectedCatalogFlyId={
                    flyPatternPickerFor === 'primary' ? primaryCatalogFlyId : dropperCatalogFlyId
                  }
                  otherActive={
                    flyPatternPickerFor === 'primary' ? primaryPatternManual : dropperPatternManual
                  }
                  onSelectUserFly={(fly) => {
                    if (flyPatternPickerFor === 'primary') {
                      setCatchFlyName(fly.name);
                      setCatchFlySize(fly.size ?? null);
                      setCatchFlyColor(fly.color ?? null);
                      setPrimaryUserBoxFlyId(fly.id);
                      setPrimaryCatalogFlyId(null);
                      setPrimaryPatternManual(false);
                      applyPresentationForPattern(fly.name, fly.size ?? null, fly.color ?? null);
                    } else {
                      setCatchFlyName2(fly.name);
                      setCatchFlySize2(fly.size ?? null);
                      setCatchFlyColor2(fly.color ?? null);
                      setDropperUserBoxFlyId(fly.id);
                      setDropperCatalogFlyId(null);
                      setDropperPatternManual(false);
                    }
                  }}
                  onSelectCatalogFly={(item) => {
                    if (flyPatternPickerFor === 'primary') {
                      setCatchFlyName(item.name);
                      setCatchFlySize(null);
                      setCatchFlyColor(null);
                      setPrimaryCatalogFlyId(item.id);
                      setPrimaryUserBoxFlyId(null);
                      setPrimaryPatternManual(false);
                      applyPresentationForPattern(item.name, null, null);
                    } else {
                      setCatchFlyName2(item.name);
                      setCatchFlySize2(null);
                      setCatchFlyColor2(null);
                      setDropperCatalogFlyId(item.id);
                      setDropperUserBoxFlyId(null);
                      setDropperPatternManual(false);
                    }
                  }}
                  initialOtherPatternName={
                    flyPatternPickerFor === 'primary'
                      ? catchFlyName
                      : (catchFlyName2 ?? '')
                  }
                  onSelectOther={(customName) => {
                    if (flyPatternPickerFor === 'primary') {
                      setCatchFlyName(customName);
                      setPrimaryUserBoxFlyId(null);
                      setPrimaryCatalogFlyId(null);
                      setPrimaryPatternManual(true);
                      setCatchPresentation(null);
                    } else {
                      setCatchFlyName2(customName);
                      setDropperUserBoxFlyId(null);
                      setDropperCatalogFlyId(null);
                      setDropperPatternManual(true);
                    }
                  }}
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
