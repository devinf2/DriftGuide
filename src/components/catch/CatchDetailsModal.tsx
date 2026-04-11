import type { RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
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

const PRESENTATION_OPTIONS: { value: PresentationMethod; label: string }[] = [
  { value: 'dry', label: 'Dry' },
  { value: 'nymph', label: 'Nymph' },
  { value: 'streamer', label: 'Streamer' },
  { value: 'wet', label: 'Wet' },
  { value: 'other', label: 'Other' },
];

function presentationMethodLabel(m: PresentationMethod | null | undefined): string {
  if (!m) return '';
  return PRESENTATION_OPTIONS.find((o) => o.value === m)?.label ?? m;
}

const STRUCTURE_OPTIONS: { value: Structure; label: string }[] = [
  { value: 'pool', label: 'Pool' },
  { value: 'riffle', label: 'Riffle' },
  { value: 'run', label: 'Run' },
  { value: 'undercut_bank', label: 'Undercut' },
  { value: 'eddy', label: 'Eddy' },
  { value: 'other', label: 'Other' },
];

function structureMethodLabel(s: Structure | null | undefined): string {
  if (!s) return '';
  return STRUCTURE_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

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

/** Read lat/lon for submit: text fields win over possibly stale pin state (syncPinFromText + setState is async). */
function resolveCatchFormCoords(
  latText: string,
  lonText: string,
  pinLat: number | null,
  pinLon: number | null,
): { lat: number | null; lon: number | null } {
  const la = latText.trim() ? Number(latText.trim()) : NaN;
  const lo = lonText.trim() ? Number(lonText.trim()) : NaN;
  if (Number.isFinite(la) && Number.isFinite(lo)) {
    return { lat: la, lon: lo };
  }
  return { lat: pinLat, lon: pinLon };
}

/** Parse lb/oz inputs; normalizes oz ≥ 16 into lb; returns null when both empty or zero after normalize. */
function parseWeightLbOz(lbText: string, ozText: string): { weight_lb: number; weight_oz: number } | null {
  const lt = lbText.trim();
  const ot = ozText.trim();
  if (lt === '' && ot === '') return null;
  const parseNonNeg = (s: string) => {
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  let lb = lt === '' ? 0 : parseNonNeg(lt);
  let oz = ot === '' ? 0 : parseNonNeg(ot);
  lb += Math.floor(oz / 16);
  oz = oz % 16;
  if (lb === 0 && oz === 0) return null;
  return { weight_lb: lb, weight_oz: oz };
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
  /**
   * Add mode only: quick log from Skip — no form defaults (e.g. released stays unset).
   * Omit to make Skip behave like dismiss (close only).
   */
  onSkipAdd?: () => void;
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
      /** Matches inter-section gap so content doesn’t float far above the action bar */
      paddingBottom: Spacing.md,
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
    coordRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
    coordInput: { flex: 1 },
    sizeWeightRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      alignItems: 'flex-start',
      marginBottom: Spacing.sm,
    },
    /** Presentation + water structure dropdowns on one row */
    presentationStructureRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      alignItems: 'flex-start',
      marginBottom: Spacing.sm,
    },
    presentationStructureCol: { flex: 1, minWidth: 0 },
    catchFlyDropdownInPair: { marginBottom: 0 },
    /** Weight column is content-sized so lb/oz never wrap; size uses remaining width. */
    sizeWeightSizeCol: { flex: 1, minWidth: 0 },
    sizeWeightWeightCol: { flexShrink: 0 },
    weightInlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      flexWrap: 'nowrap' as const,
    },
    weightNumInput: {
      width: 40,
      textAlign: 'center' as const,
      paddingHorizontal: 4,
      marginBottom: 0,
      backgroundColor: colors.background,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
    weightSuffix: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    catchModalInputNoBottomMargin: { marginBottom: 0 },
    exifHint: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 0,
      marginBottom: Spacing.sm,
      lineHeight: 18,
    },
    flyFieldLabel: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: Spacing.xs,
    },
    importCatchTimeRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
      marginTop: Spacing.xs,
    },
    importCatchTimeCol: { flex: 1 },
    importCatchTimeLabel: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 4,
    },
    importCatchTimeBtn: {
      backgroundColor: colors.background,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    importCatchTimeBtnText: {
      fontSize: FontSize.md,
      color: colors.text,
    },
    importCatchPickerOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    importCatchPickerSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.xl,
      borderTopRightRadius: BorderRadius.xl,
      paddingBottom: Spacing.xxl,
      paddingHorizontal: Spacing.lg,
    },
    importCatchPickerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: Spacing.md,
    },
    importCatchPickerTitle: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
    },
    importCatchPickerDone: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.primary,
    },
    catchFlyDropdownRowWrap: {
      flexDirection: 'row',
      gap: Spacing.xs,
      marginBottom: Spacing.sm,
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
    /** Species / presentation / structure: full-area dim; sheet is positioned under the field */
    pickerOverlayHostAnchored: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      zIndex: 50,
      elevation: 50,
    },
    anchoredPickerSheet: {
      position: 'absolute',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      ...(Platform.OS === 'ios'
        ? {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.18,
            shadowRadius: 8,
          }
        : { elevation: 12 }),
    },
    /** Fills fixed-height sheet so ScrollView gets a bounded viewport and scrolls. */
    anchoredPickerScrollFill: { flex: 1, minHeight: 0 },
    anchoredPickerScrollContent: { flexGrow: 0 },
    anchoredSearchInput: {
      marginHorizontal: Spacing.sm,
      marginTop: Spacing.sm,
      marginBottom: Spacing.xs,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.sm,
      fontSize: FontSize.sm,
      color: colors.text,
      backgroundColor: colors.background,
    },
    anchoredPickerOption: {
      paddingVertical: 6,
      paddingHorizontal: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    anchoredPickerOptionActive: { backgroundColor: colors.background },
    anchoredPickerOptionText: { fontSize: FontSize.sm, color: colors.text },
    anchoredPickerOptionTextActive: { color: colors.primary, fontWeight: '600' },
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
      marginBottom: Spacing.sm,
    },
    catchFlyRigRadioPressable: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 2,
      marginRight: -Spacing.xs,
    },
    flyFieldLabelInline: { marginBottom: 0, flex: 1, minWidth: 0 },
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
    /** Inline next to “Secondary fly” header */
    removeSecondaryFlyButton: {
      paddingVertical: 4,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.primary,
      borderStyle: 'dashed',
      flexShrink: 0,
      marginBottom: 0,
    },
    removeSecondaryFlyButtonText: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.primary,
    },
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
      marginBottom: Spacing.sm,
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
    /** Released chips + catch depth on one row */
    releasedDepthRow: {
      flexDirection: 'row',
      gap: Spacing.md,
      alignItems: 'flex-start',
      marginBottom: Spacing.sm,
    },
    releasedDepthLeft: { flex: 1, minWidth: 0 },
    releasedDepthRight: { minWidth: 108, maxWidth: 140, flexShrink: 0, alignSelf: 'stretch' },
    releasedDepthChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    catchDepthInput: { marginBottom: 0 },
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
  onSkipAdd,
  onPickPhoto: onPickPhotoProp,
  deferCloudWrites = false,
  initialAddPhotoUris,
  importPhotoMetaSeed = null,
}: CatchDetailsModalProps) {
  const { colors, resolvedScheme } = useAppTheme();
  const pickerThemeVariant = resolvedScheme === 'dark' ? 'dark' : 'light';
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
  const [catchWeightLb, setCatchWeightLb] = useState('');
  const [catchWeightOz, setCatchWeightOz] = useState('');
  const [catchNote, setCatchNote] = useState('');
  const [catchDepth, setCatchDepth] = useState('');
  const [catchPhotoUris, setCatchPhotoUris] = useState<string[]>([]);
  /** Remote URLs present when edit form opened (for delete-on-remove). */
  const initialEditRemoteUrlsRef = useRef<string[]>([]);
  /** Set when user picks a photo that includes EXIF (library or camera). */
  const [photoExifMeta, setPhotoExifMeta] = useState<PhotoExifMetadata | null>(null);
  const [catchCaughtOnFly, setCatchCaughtOnFly] = useState<'primary' | 'dropper' | null>(null);
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
  const [catchPresentationDropdownOpen, setCatchPresentationDropdownOpen] = useState(false);
  const [catchStructureDropdownOpen, setCatchStructureDropdownOpen] = useState(false);
  const [catchSpeciesSearch, setCatchSpeciesSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [coordRecenterTick, setCoordRecenterTick] = useState(0);
  /** Until true, map uses `editTargetCatch` coords so we don't flash the previous catch's pin. */
  const [editPinFormSynced, setEditPinFormSynced] = useState(false);
  const [gpsFillBusy, setGpsFillBusy] = useState(false);
  /** Log past trips / imported draft: user-set catch instant (date + time). */
  const [importCatchAt, setImportCatchAt] = useState(() => new Date());
  const [showImportDatePicker, setShowImportDatePicker] = useState(false);
  const [showImportTimePicker, setShowImportTimePicker] = useState(false);

  const catchModalContentRef = useRef<View>(null);
  const speciesFieldRef = useRef<View>(null);
  const presentationFieldRef = useRef<View>(null);
  const structureFieldRef = useRef<View>(null);
  /** Position for species / presentation / structure sheets (relative to catch modal box). */
  const [anchoredDropdownLayout, setAnchoredDropdownLayout] = useState<{
    top: number;
    left: number;
    width: number;
    maxScroll: number;
  } | null>(null);

  /** Log past trips: all catches on an imported draft (add + edit), not live sessions. */
  const showImportCatchTime =
    Boolean(trip.imported) && (mode === 'add' || (mode === 'edit' && deferCloudWrites));

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

  const measureOpenBelowField = useCallback((fieldRef: RefObject<View | null>, thenOpen: () => void) => {
    const modal = catchModalContentRef.current;
    const field = fieldRef.current;
    if (!modal || !field) {
      setAnchoredDropdownLayout(null);
      thenOpen();
      return;
    }
    modal.measureInWindow((mx, my, mw, mh) => {
      field.measureInWindow((fx, fy, fw, fh) => {
        const pad = Spacing.sm;
        let left = fx - mx;
        let width = Math.max(fw, 200);
        const innerW = mw - pad * 2;
        width = Math.min(width, innerW);
        if (left + width > mw - pad) left = Math.max(pad, mw - pad - width);
        if (left < pad) left = pad;
        const top = fy - my + fh + 2;
        const footerReserve = 56;
        const available = mh - top - pad - footerReserve;
        const maxScroll = Math.max(180, Math.min(360, available));
        setAnchoredDropdownLayout({ top, left, width, maxScroll });
        thenOpen();
      });
    });
  }, []);

  const openSpeciesDropdown = useCallback(() => {
    Keyboard.dismiss();
    setCatchFlyDropdownOpen(null);
    setCatchPresentationDropdownOpen(false);
    setCatchStructureDropdownOpen(false);
    requestAnimationFrame(() => {
      measureOpenBelowField(speciesFieldRef, () => setCatchSpeciesDropdownOpen(true));
    });
  }, [measureOpenBelowField]);

  const openPresentationDropdown = useCallback(() => {
    Keyboard.dismiss();
    setCatchFlyDropdownOpen(null);
    setCatchSpeciesDropdownOpen(false);
    setCatchStructureDropdownOpen(false);
    requestAnimationFrame(() => {
      measureOpenBelowField(presentationFieldRef, () => setCatchPresentationDropdownOpen(true));
    });
  }, [measureOpenBelowField]);

  const openStructureDropdown = useCallback(() => {
    Keyboard.dismiss();
    setCatchFlyDropdownOpen(null);
    setCatchSpeciesDropdownOpen(false);
    setCatchPresentationDropdownOpen(false);
    requestAnimationFrame(() => {
      measureOpenBelowField(structureFieldRef, () => setCatchStructureDropdownOpen(true));
    });
  }, [measureOpenBelowField]);

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
    setCatchWeightLb('');
    setCatchWeightOz('');
    setCatchNote('');
    setCatchDepth('');
    setCatchPhotoUris([]);
    initialEditRemoteUrlsRef.current = [];
    setPhotoExifMeta(null);
    setCatchCaughtOnFly(null);
    setCatchReleased(true);
    setCatchStructure(null);
    setPinLat(null);
    setPinLon(null);
    setLatText('');
    setLonText('');
    setCatchPresentation(null);
    setFlyPatternPickerOpen(false);
  }, [seedPrimary, seedDropper]);

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
      setCatchWeightLb(data.weight_lb != null ? String(data.weight_lb) : '');
      setCatchWeightOz(data.weight_oz != null ? String(data.weight_oz) : '');
      setCatchNote(data.note ?? '');
      setCatchDepth(data.depth_ft != null ? String(data.depth_ft) : '');
      setCatchPhotoUris(normalizeCatchPhotoUrls(data));
      initialEditRemoteUrlsRef.current = normalizeCatchPhotoUrls(data).filter(isRemoteStorageUrl);
      setPhotoExifMeta(null);
      setCatchCaughtOnFly(
        data.caught_on_fly === 'dropper' ? 'dropper' : data.caught_on_fly === 'primary' ? 'primary' : null,
      );
      const primaryPatternTrim = (fd?.pattern ?? '').trim();
      if (!primaryPatternTrim) {
        setCatchPresentation(null);
      } else if (ps.manual) {
        setCatchPresentation(data.presentation_method ?? null);
      } else if (getPresentationForFly) {
        setCatchPresentation(
          getPresentationForFly(primaryPatternTrim, fd?.size ?? null, fd?.color ?? null),
        );
      } else {
        setCatchPresentation(data.presentation_method ?? null);
      }
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
      if (laOk != null && loOk != null) {
        setCoordRecenterTick((t) => t + 1);
      }
      if (trip.imported) {
        const ts = Date.parse(ev.timestamp);
        setImportCatchAt(Number.isNaN(ts) ? new Date() : new Date(ts));
      }
    },
    [allEvents, userFlies, resolvedFlyCatalog, trip.imported, getPresentationForFly],
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
    if (!visible) {
      setShowImportDatePicker(false);
      setShowImportTimePicker(false);
      setCatchSpeciesDropdownOpen(false);
      setCatchPresentationDropdownOpen(false);
      setCatchStructureDropdownOpen(false);
      setAnchoredDropdownLayout(null);
    }
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
    if (trip.imported) {
      const baseFromTrip =
        trip.start_time && !Number.isNaN(Date.parse(trip.start_time))
          ? new Date(trip.start_time)
          : new Date();
      const initialCatchAt =
        seedTimeOk && seed?.takenAt ? new Date(seed.takenAt) : baseFromTrip;
      setImportCatchAt(initialCatchAt);
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

  /** Catalog/box primary fly → presentation from fly; manual “Other” pattern → no auto-fill (user picks or saved value). */
  useEffect(() => {
    if (!visible || !catchFlyName.trim() || !getPresentationForFly || primaryPatternManual) return;
    setCatchPresentation(getPresentationForFly(catchFlyName.trim(), catchFlySize, catchFlyColor));
  }, [visible, catchFlyName, catchFlySize, catchFlyColor, getPresentationForFly, primaryPatternManual]);

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

  const onImportCatchDateChange = useCallback((_e: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowImportDatePicker(false);
    if (date) {
      setImportCatchAt((prev) => {
        const next = new Date(date);
        next.setHours(prev.getHours(), prev.getMinutes(), prev.getSeconds(), prev.getMilliseconds());
        return next;
      });
    }
  }, []);

  const onImportCatchTimeChange = useCallback((_e: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowImportTimePicker(false);
    if (date) {
      setImportCatchAt((prev) => {
        const next = new Date(prev);
        next.setHours(date.getHours(), date.getMinutes(), 0, 0);
        return next;
      });
    }
  }, []);

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
    setCatchPresentationDropdownOpen(false);
    setCatchStructureDropdownOpen(false);
    setAnchoredDropdownLayout(null);
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
    const weightParsed = parseWeightLbOz(catchWeightLb, catchWeightOz);
    const depthNum = catchDepth.trim() ? parseFloat(catchDepth.trim()) : null;
    const { lat, lon } = resolveCatchFormCoords(latText, lonText, pinLat, pinLon);
    if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
      setPinLat(lat);
      setPinLon(lon);
    }

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
        if (trip.imported) {
          catchTimestampIso = importCatchAt.toISOString();
          photoCapturedAtIso = catchTimestampIso;
        } else if (photoExifMeta?.takenAt) {
          catchTimestampIso = photoExifMeta.takenAt.toISOString();
          photoCapturedAtIso = catchTimestampIso;
        }

        let conditionsSnapshot: EventConditionsSnapshot | null | undefined = undefined;
        const tForWeather = trip.imported ? importCatchAt : (photoExifMeta?.takenAt ?? null);
        if (tForWeather != null && lat != null && lon != null) {
          const hist = await fetchHistoricalWeather(lat, lon, tForWeather);
          conditionsSnapshot = hist ? buildEventConditionsSnapshot(hist, null, tForWeather) : null;
        }

        await onSubmitAdd({
          primary,
          dropper,
          catchFields: {
            species: species ?? undefined,
            size_inches: sizeNum ?? undefined,
            ...(weightParsed
              ? { weight_lb: weightParsed.weight_lb, weight_oz: weightParsed.weight_oz }
              : {}),
            note: catchNote.trim() || undefined,
            ...(catchCaughtOnFly != null ? { caught_on_fly: catchCaughtOnFly } : {}),
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
          weight_lb: weightParsed ? weightParsed.weight_lb : null,
          weight_oz: weightParsed ? weightParsed.weight_oz : null,
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
        if (trip.imported && deferCloudWrites) {
          eventOverrides = { timestamp: importCatchAt.toISOString() };
        }
        const addedLocalPhoto = newLocalUris.length > 0;
        if (addedLocalPhoto && photoExifMeta?.takenAt && lat != null && lon != null) {
          const hist = await fetchHistoricalWeather(lat, lon, photoExifMeta.takenAt);
          eventOverrides = {
            ...eventOverrides,
            conditions_snapshot: hist
              ? buildEventConditionsSnapshot(hist, null, photoExifMeta.takenAt)
              : null,
          };
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
            setCatchPhotoUris([]);
            setPhotoExifMeta(null);
            onClose();
          }}
        />
        <View style={styles.catchModalOverlay}>
          <View ref={catchModalContentRef} style={styles.catchModal} collapsable={false}>
            <View style={styles.catchModalHeader}>
              <Text style={styles.catchModalTitle} numberOfLines={1}>
                {title}
              </Text>
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  setCatchPhotoUris([]);
                  setPhotoExifMeta(null);
                  onClose();
                }}
                hitSlop={12}
                style={styles.catchModalHeaderClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <MaterialIcons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.catchModalScroll}
              contentContainerStyle={styles.catchModalScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              nestedScrollEnabled
            >
              {showImportCatchTime ? (
                <View style={{ marginBottom: Spacing.sm }}>
                  <Text style={styles.flyFieldLabel}>When was this catch?</Text>
                  <Text style={[styles.coordHint, { marginBottom: Spacing.sm }]}>
                    Defaults to photo time when available, otherwise the trip start from the import flow.
                  </Text>
                  <View style={styles.importCatchTimeRow}>
                    <View style={styles.importCatchTimeCol}>
                      <Text style={styles.importCatchTimeLabel}>Date</Text>
                      <Pressable
                        style={styles.importCatchTimeBtn}
                        onPress={() => {
                          setShowImportTimePicker(false);
                          setShowImportDatePicker((v) => !v);
                        }}
                      >
                        <Text style={styles.importCatchTimeBtnText} numberOfLines={1}>
                          {format(importCatchAt, 'EEE, MMM d, yyyy')}
                        </Text>
                      </Pressable>
                    </View>
                    <View style={styles.importCatchTimeCol}>
                      <Text style={styles.importCatchTimeLabel}>Time</Text>
                      <Pressable
                        style={styles.importCatchTimeBtn}
                        onPress={() => {
                          setShowImportDatePicker(false);
                          setShowImportTimePicker((v) => !v);
                        }}
                      >
                        <Text style={styles.importCatchTimeBtnText}>{format(importCatchAt, 'h:mm a')}</Text>
                      </Pressable>
                    </View>
                  </View>
                  {Platform.OS === 'ios' && showImportDatePicker ? (
                    <DateTimePicker
                      value={importCatchAt}
                      mode="date"
                      display="inline"
                      onChange={onImportCatchDateChange}
                      themeVariant={pickerThemeVariant}
                    />
                  ) : null}
                  {Platform.OS === 'ios' && showImportTimePicker ? (
                    <DateTimePicker
                      value={importCatchAt}
                      mode="time"
                      display="spinner"
                      onChange={onImportCatchTimeChange}
                      themeVariant={pickerThemeVariant}
                    />
                  ) : null}
                </View>
              ) : null}
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
                <Pressable
                  style={styles.catchFlyDropdownCell}
                  onPress={() => {
                    setCatchSpeciesDropdownOpen(false);
                    setCatchPresentationDropdownOpen(false);
                    setCatchStructureDropdownOpen(false);
                    setAnchoredDropdownLayout(null);
                    setCatchFlyDropdownOpen('size');
                  }}
                >
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
                <Pressable
                  style={styles.catchFlyDropdownCell}
                  onPress={() => {
                    setCatchSpeciesDropdownOpen(false);
                    setCatchPresentationDropdownOpen(false);
                    setCatchStructureDropdownOpen(false);
                    setAnchoredDropdownLayout(null);
                    setCatchFlyDropdownOpen('color');
                  }}
                >
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
                  <View style={styles.catchFlyRigHeaderRow}>
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
                    <Text
                      style={[styles.flyFieldLabel, styles.flyFieldLabelInline]}
                      numberOfLines={1}
                    >
                      Secondary fly
                    </Text>
                    <Pressable
                      style={styles.removeSecondaryFlyButton}
                      onPress={() => {
                        setCatchFlyName2(null);
                        setCatchFlySize2(null);
                        setCatchFlyColor2(null);
                        setDropperUserBoxFlyId(null);
                        setDropperCatalogFlyId(null);
                        setDropperPatternManual(false);
                        setCatchCaughtOnFly(null);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Remove secondary fly"
                    >
                      <Text style={styles.removeSecondaryFlyButtonText} numberOfLines={1}>
                        Remove secondary
                      </Text>
                    </Pressable>
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
                    <Pressable
                      style={styles.catchFlyDropdownCell}
                      onPress={() => {
                        setCatchSpeciesDropdownOpen(false);
                        setCatchPresentationDropdownOpen(false);
                        setCatchStructureDropdownOpen(false);
                        setAnchoredDropdownLayout(null);
                        setCatchFlyDropdownOpen('size2');
                      }}
                    >
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
                    <Pressable
                      style={styles.catchFlyDropdownCell}
                      onPress={() => {
                        setCatchSpeciesDropdownOpen(false);
                        setCatchPresentationDropdownOpen(false);
                        setCatchStructureDropdownOpen(false);
                        setAnchoredDropdownLayout(null);
                        setCatchFlyDropdownOpen('color2');
                      }}
                    >
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

              <View style={styles.sizeWeightRow}>
                <View style={styles.sizeWeightSizeCol}>
                  <Text style={styles.flyFieldLabel}>Size (inches)</Text>
                  <TextInput
                    style={[styles.catchModalInput, styles.catchModalInputNoBottomMargin]}
                    placeholder="e.g. 14"
                    placeholderTextColor={colors.textTertiary}
                    value={catchSize}
                    onChangeText={setCatchSize}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.sizeWeightWeightCol}>
                  <Text style={styles.flyFieldLabel}>Weight</Text>
                  <View style={styles.weightInlineRow}>
                    <TextInput
                      style={styles.weightNumInput}
                      placeholder="0"
                      placeholderTextColor={colors.textTertiary}
                      value={catchWeightLb}
                      onChangeText={setCatchWeightLb}
                      keyboardType="number-pad"
                      maxLength={4}
                      accessibilityLabel="Pounds"
                    />
                    <Text style={styles.weightSuffix}>lb</Text>
                    <TextInput
                      style={styles.weightNumInput}
                      placeholder="0"
                      placeholderTextColor={colors.textTertiary}
                      value={catchWeightOz}
                      onChangeText={setCatchWeightOz}
                      keyboardType="number-pad"
                      maxLength={2}
                      accessibilityLabel="Ounces"
                    />
                    <Text style={styles.weightSuffix}>oz</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.flyFieldLabel}>Species</Text>
              <Pressable
                ref={speciesFieldRef}
                style={styles.catchFlyDropdownRow}
                onPress={openSpeciesDropdown}
                accessibilityRole="combobox"
                accessibilityState={{ expanded: catchSpeciesDropdownOpen }}
              >
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
              <View style={styles.presentationStructureRow}>
                <View style={styles.presentationStructureCol}>
                  <Text style={styles.flyFieldLabel}>Presentation</Text>
                  <Pressable
                    ref={presentationFieldRef}
                    style={[styles.catchFlyDropdownRow, styles.catchFlyDropdownInPair]}
                    onPress={openPresentationDropdown}
                    accessibilityRole="combobox"
                    accessibilityState={{ expanded: catchPresentationDropdownOpen }}
                  >
                    <Text
                      style={[
                        styles.catchFlyDropdownValue,
                        catchPresentation == null && styles.catchFlyDropdownPlaceholder,
                      ]}
                      numberOfLines={1}
                    >
                      {catchPresentation != null
                        ? presentationMethodLabel(catchPresentation)
                        : 'Select presentation'}
                    </Text>
                    <MaterialIcons name="keyboard-arrow-down" size={16} color={colors.textSecondary} />
                  </Pressable>
                </View>
                <View style={styles.presentationStructureCol}>
                  <Text style={styles.flyFieldLabel}>Water structure</Text>
                  <Pressable
                    ref={structureFieldRef}
                    style={[styles.catchFlyDropdownRow, styles.catchFlyDropdownInPair]}
                    onPress={openStructureDropdown}
                    accessibilityRole="combobox"
                    accessibilityState={{ expanded: catchStructureDropdownOpen }}
                  >
                    <Text
                      style={[
                        styles.catchFlyDropdownValue,
                        catchStructure == null && styles.catchFlyDropdownPlaceholder,
                      ]}
                      numberOfLines={1}
                    >
                      {catchStructure != null
                        ? structureMethodLabel(catchStructure)
                        : 'Select structure'}
                    </Text>
                    <MaterialIcons name="keyboard-arrow-down" size={16} color={colors.textSecondary} />
                  </Pressable>
                </View>
              </View>
              <View style={styles.releasedDepthRow}>
                <View style={styles.releasedDepthLeft}>
                  <Text style={styles.flyFieldLabel}>Released?</Text>
                  <View style={styles.releasedDepthChipRow}>
                    <Pressable
                      style={[styles.chip, catchReleased === true && styles.chipActive]}
                      onPress={() => setCatchReleased(true)}
                    >
                      <Text style={[styles.chipText, catchReleased === true && styles.chipTextActive]}>
                        Released
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.chip, catchReleased === false && styles.chipActive]}
                      onPress={() => setCatchReleased(false)}
                    >
                      <Text style={[styles.chipText, catchReleased === false && styles.chipTextActive]}>Kept</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.releasedDepthRight}>
                  <Text style={styles.flyFieldLabel}>Catch Depth</Text>
                  <TextInput
                    style={[styles.catchModalInput, styles.catchDepthInput]}
                    placeholder="e.g. 3"
                    placeholderTextColor={colors.textTertiary}
                    value={catchDepth}
                    onChangeText={setCatchDepth}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              <Text style={styles.flyFieldLabel}>Notes</Text>
              <TextInput
                style={[styles.catchModalInput, styles.catchModalNoteInput]}
                placeholder="Optional note"
                placeholderTextColor={colors.textTertiary}
                value={catchNote}
                onChangeText={setCatchNote}
                multiline
              />

              {mode === 'add' ? (
                <>
                  <Text style={[styles.flyFieldLabel, { marginTop: Spacing.sm }]}>Catch location</Text>
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
                  <Text style={[styles.flyFieldLabel, { marginTop: Spacing.sm }]}>Catch location</Text>
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

            {showImportCatchTime && Platform.OS === 'android' ? (
              <>
                <Modal
                  visible={showImportDatePicker}
                  transparent
                  animationType="fade"
                  onRequestClose={() => setShowImportDatePicker(false)}
                >
                  <Pressable
                    style={styles.importCatchPickerOverlay}
                    onPress={() => setShowImportDatePicker(false)}
                  >
                    <View style={styles.importCatchPickerSheet}>
                      <View style={styles.importCatchPickerHeader}>
                        <Text style={styles.importCatchPickerTitle}>Select date</Text>
                        <Pressable onPress={() => setShowImportDatePicker(false)}>
                          <Text style={styles.importCatchPickerDone}>Done</Text>
                        </Pressable>
                      </View>
                      <DateTimePicker
                        value={importCatchAt}
                        mode="date"
                        display="default"
                        onChange={onImportCatchDateChange}
                        themeVariant={pickerThemeVariant}
                      />
                    </View>
                  </Pressable>
                </Modal>
                <Modal
                  visible={showImportTimePicker}
                  transparent
                  animationType="fade"
                  onRequestClose={() => setShowImportTimePicker(false)}
                >
                  <Pressable
                    style={styles.importCatchPickerOverlay}
                    onPress={() => setShowImportTimePicker(false)}
                  >
                    <View style={styles.importCatchPickerSheet}>
                      <View style={styles.importCatchPickerHeader}>
                        <Text style={styles.importCatchPickerTitle}>Select time</Text>
                        <Pressable onPress={() => setShowImportTimePicker(false)}>
                          <Text style={styles.importCatchPickerDone}>Done</Text>
                        </Pressable>
                      </View>
                      <DateTimePicker
                        value={importCatchAt}
                        mode="time"
                        display="default"
                        onChange={onImportCatchTimeChange}
                        themeVariant={pickerThemeVariant}
                      />
                    </View>
                  </Pressable>
                </Modal>
              </>
            ) : null}

            {catchFlyDropdownOpen !== null ? (
              <View style={styles.pickerOverlayHost} pointerEvents="box-none">
                <Pressable
                  style={styles.pickerBackdrop}
                  onPress={() => {
                    Keyboard.dismiss();
                    setCatchFlyDropdownOpen(null);
                    setCatchSpeciesDropdownOpen(false);
                    setCatchPresentationDropdownOpen(false);
                    setCatchStructureDropdownOpen(false);
                    setAnchoredDropdownLayout(null);
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
              <View style={styles.pickerOverlayHostAnchored} pointerEvents="box-none">
                <Pressable
                  style={styles.pickerBackdrop}
                  onPress={() => {
                    Keyboard.dismiss();
                    setCatchSpeciesDropdownOpen(false);
                    setCatchPresentationDropdownOpen(false);
                    setCatchStructureDropdownOpen(false);
                    setAnchoredDropdownLayout(null);
                  }}
                />
                <View
                  style={[
                    styles.anchoredPickerSheet,
                    anchoredDropdownLayout
                      ? {
                          top: anchoredDropdownLayout.top,
                          left: anchoredDropdownLayout.left,
                          width: anchoredDropdownLayout.width,
                          maxHeight: anchoredDropdownLayout.maxScroll + 58,
                        }
                      : { top: 120, left: Spacing.lg, right: Spacing.lg, maxHeight: 340 },
                  ]}
                >
                  <TextInput
                    style={styles.anchoredSearchInput}
                    placeholder="Search species…"
                    placeholderTextColor={colors.textTertiary}
                    value={catchSpeciesSearch}
                    onChangeText={setCatchSpeciesSearch}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  <ScrollView
                    style={{ height: anchoredDropdownLayout?.maxScroll ?? 260 }}
                    contentContainerStyle={styles.anchoredPickerScrollContent}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                  >
                    {filteredSpeciesOptions.map((species) => {
                      const isOther = species === 'Other';
                      const isSelected = isOther
                        ? catchSpeciesOther
                        : !catchSpeciesOther && catchSpecies === species;
                      return (
                        <Pressable
                          key={species}
                          style={[
                            styles.anchoredPickerOption,
                            isSelected && styles.anchoredPickerOptionActive,
                          ]}
                          onPress={() => {
                            if (isOther) {
                              setCatchSpecies('');
                              setCatchSpeciesOther(true);
                            } else {
                              setCatchSpecies(species);
                              setCatchSpeciesOther(false);
                            }
                            setCatchSpeciesDropdownOpen(false);
                            setAnchoredDropdownLayout(null);
                          }}
                        >
                          <Text
                            style={[
                              styles.anchoredPickerOptionText,
                              isSelected && styles.anchoredPickerOptionTextActive,
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

            {catchPresentationDropdownOpen ? (
              <View style={styles.pickerOverlayHostAnchored} pointerEvents="box-none">
                <Pressable
                  style={styles.pickerBackdrop}
                  onPress={() => {
                    Keyboard.dismiss();
                    setCatchPresentationDropdownOpen(false);
                    setCatchStructureDropdownOpen(false);
                    setAnchoredDropdownLayout(null);
                  }}
                />
                <View
                  style={[
                    styles.anchoredPickerSheet,
                    anchoredDropdownLayout
                      ? {
                          top: anchoredDropdownLayout.top,
                          left: anchoredDropdownLayout.left,
                          width: anchoredDropdownLayout.width,
                          height: anchoredDropdownLayout.maxScroll,
                          maxHeight: anchoredDropdownLayout.maxScroll,
                        }
                      : { top: 120, left: Spacing.lg, right: Spacing.lg, height: 300, maxHeight: 300 },
                  ]}
                >
                  <ScrollView
                    style={styles.anchoredPickerScrollFill}
                    contentContainerStyle={styles.anchoredPickerScrollContent}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                  >
                    <Pressable
                      style={[
                        styles.anchoredPickerOption,
                        catchPresentation == null && styles.anchoredPickerOptionActive,
                      ]}
                      onPress={() => {
                        setCatchPresentation(null);
                        setCatchPresentationDropdownOpen(false);
                        setAnchoredDropdownLayout(null);
                      }}
                    >
                      <Text
                        style={[
                          styles.anchoredPickerOptionText,
                          catchPresentation == null && styles.anchoredPickerOptionTextActive,
                        ]}
                      >
                        None
                      </Text>
                    </Pressable>
                    {PRESENTATION_OPTIONS.map((opt) => {
                      const isSelected = catchPresentation === opt.value;
                      return (
                        <Pressable
                          key={opt.value}
                          style={[
                            styles.anchoredPickerOption,
                            isSelected && styles.anchoredPickerOptionActive,
                          ]}
                          onPress={() => {
                            setCatchPresentation(opt.value);
                            setCatchPresentationDropdownOpen(false);
                            setAnchoredDropdownLayout(null);
                          }}
                        >
                          <Text
                            style={[
                              styles.anchoredPickerOptionText,
                              isSelected && styles.anchoredPickerOptionTextActive,
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

            {catchStructureDropdownOpen ? (
              <View style={styles.pickerOverlayHostAnchored} pointerEvents="box-none">
                <Pressable
                  style={styles.pickerBackdrop}
                  onPress={() => {
                    Keyboard.dismiss();
                    setCatchStructureDropdownOpen(false);
                    setCatchPresentationDropdownOpen(false);
                    setAnchoredDropdownLayout(null);
                  }}
                />
                <View
                  style={[
                    styles.anchoredPickerSheet,
                    anchoredDropdownLayout
                      ? {
                          top: anchoredDropdownLayout.top,
                          left: anchoredDropdownLayout.left,
                          width: anchoredDropdownLayout.width,
                          height: anchoredDropdownLayout.maxScroll,
                          maxHeight: anchoredDropdownLayout.maxScroll,
                        }
                      : { top: 120, left: Spacing.lg, right: Spacing.lg, height: 300, maxHeight: 300 },
                  ]}
                >
                  <ScrollView
                    style={styles.anchoredPickerScrollFill}
                    contentContainerStyle={styles.anchoredPickerScrollContent}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                  >
                    <Pressable
                      style={[
                        styles.anchoredPickerOption,
                        catchStructure == null && styles.anchoredPickerOptionActive,
                      ]}
                      onPress={() => {
                        setCatchStructure(null);
                        setCatchStructureDropdownOpen(false);
                        setAnchoredDropdownLayout(null);
                      }}
                    >
                      <Text
                        style={[
                          styles.anchoredPickerOptionText,
                          catchStructure == null && styles.anchoredPickerOptionTextActive,
                        ]}
                      >
                        None
                      </Text>
                    </Pressable>
                    {STRUCTURE_OPTIONS.map((opt) => {
                      const isSelected = catchStructure === opt.value;
                      return (
                        <Pressable
                          key={opt.value}
                          style={[
                            styles.anchoredPickerOption,
                            isSelected && styles.anchoredPickerOptionActive,
                          ]}
                          onPress={() => {
                            setCatchStructure(opt.value);
                            setCatchStructureDropdownOpen(false);
                            setAnchoredDropdownLayout(null);
                          }}
                        >
                          <Text
                            style={[
                              styles.anchoredPickerOptionText,
                              isSelected && styles.anchoredPickerOptionTextActive,
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

            <View style={styles.catchModalActions}>
              <Pressable
                style={styles.catchModalCancel}
                onPress={() => {
                  Keyboard.dismiss();
                  setCatchPhotoUris([]);
                  setPhotoExifMeta(null);
                  if (mode === 'add' && onSkipAdd) {
                    onSkipAdd();
                  }
                  onClose();
                }}
                accessibilityLabel={
                  mode === 'add' && onSkipAdd
                    ? 'Skip, log catch without filling details'
                    : 'Skip, close without saving'
                }
              >
                <Text style={styles.catchModalCancelText}>Skip</Text>
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
