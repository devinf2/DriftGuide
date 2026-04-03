import { NearbyRootLocationPickerModal } from '@/src/components/importPastTrips/NearbyRootLocationPickerModal';
import {
  CatchDetailsModal,
  type CatchDetailsSubmitAdd,
} from '@/src/components/catch/CatchDetailsModal';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { fetchFlies } from '@/src/services/flyService';
import { searchNearbyRootParentCandidates } from '@/src/services/locationService';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import {
  type ImportPhoto,
  type ImportTripGroup,
  useImportPastTripsStore,
} from '@/src/stores/importPastTripsStore';
import { useAuthStore } from '@/src/stores/authStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { CatchData, Fly, Location, NearbyLocationResult, TripEvent } from '@/src/types';
import { extractPhotoMetadataFromPickerAsset } from '@/src/utils/imageExif';
import { getFlyForCatch } from '@/src/services/sync';
import {
  buildCompletedTripForImport,
  finalizeImportGroup,
} from '@/src/utils/importPastTrips/finalizeImport';
import { format, parseISO } from 'date-fns';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ExpoLocation from 'expo-location';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';

const STEP_TITLES = ['Upload', 'Trips', 'Tag catches', 'Review'] as const;
const TOTAL_STEPS = STEP_TITLES.length;

function nearbyResultToLocation(c: NearbyLocationResult): Location {
  const st = c.status;
  const status =
    st === 'verified' || st === 'community' || st === 'pending' ? st : undefined;
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    parent_location_id: null,
    latitude: c.latitude,
    longitude: c.longitude,
    metadata: {},
    status,
  };
}

function computeAnchor(photoIds: string[], photos: ImportPhoto[]): { lat: number; lng: number } | null {
  const pts = photoIds
    .map((id) => photos.find((p) => p.id === id))
    .filter(Boolean)
    .map((p) => p!.meta)
    .filter((m) => m.latitude != null && m.longitude != null);
  if (pts.length === 0) return null;
  const lat = pts.reduce((s, p) => s + (p.latitude as number), 0) / pts.length;
  const lng = pts.reduce((s, p) => s + (p.longitude as number), 0) / pts.length;
  return { lat, lng };
}

function groupDisplayLabel(tripDateKey: string, photos: ImportPhoto[], photoIds: string[]): string {
  if (tripDateKey && tripDateKey !== '__unknown__') {
    try {
      return format(parseISO(`${tripDateKey}T12:00:00`), 'MMM d, yyyy');
    } catch {
      return tripDateKey;
    }
  }
  return 'Unknown date';
}

function formatPhotoTakenLabel(takenAt: Date | null): string {
  if (!takenAt) return 'No date';
  try {
    return format(takenAt, 'MMM d, yyyy');
  } catch {
    return 'No date';
  }
}

function step3Valid(groups: ReturnType<typeof useImportPastTripsStore.getState>['groups']): boolean {
  return groups.every((g) => g.locationId != null && g.location != null);
}

function step4Valid(groups: ReturnType<typeof useImportPastTripsStore.getState>['groups']): boolean {
  for (const g of groups) {
    for (const pid of g.photoIds) {
      const st = g.photoStates[pid];
      if (!st || st.kind === 'untagged') return false;
    }
  }
  return true;
}

/** One UI row on tag step: scenery / untagged fish / catch (possibly multiple photos, one card). */
type Step3Row =
  | { kind: 'scenery'; photoId: string }
  | { kind: 'untagged'; photoId: string }
  | { kind: 'catch'; catchEventId: string; photoIds: string[] };

function buildStep3Rows(group: ImportTripGroup): Step3Row[] {
  const rows: Step3Row[] = [];
  const seenCatch = new Set<string>();
  for (const pid of group.photoIds) {
    const st = group.photoStates[pid] ?? { kind: 'untagged' };
    if (st.kind === 'scenery') {
      rows.push({ kind: 'scenery', photoId: pid });
    } else if (st.kind === 'untagged') {
      rows.push({ kind: 'untagged', photoId: pid });
    } else {
      if (seenCatch.has(st.catchEventId)) continue;
      seenCatch.add(st.catchEventId);
      const photoIds = group.photoIds.filter((p) => {
        const s = group.photoStates[p] ?? { kind: 'untagged' };
        return s.kind === 'catch' && s.catchEventId === st.catchEventId;
      });
      rows.push({ kind: 'catch', catchEventId: st.catchEventId, photoIds });
    }
  }
  return rows;
}

/** 1-based fish index among fish rows (each multi-photo catch counts as one fish). */
function step3FishOrdinalForRow(group: ImportTripGroup, row: Step3Row): number | null {
  if (row.kind === 'scenery') return null;
  const rows = buildStep3Rows(group);
  let n = 0;
  for (const r of rows) {
    if (r.kind === 'scenery') continue;
    n += 1;
    if (row.kind === 'untagged' && r.kind === 'untagged' && r.photoId === row.photoId) return n;
    if (row.kind === 'catch' && r.kind === 'catch' && r.catchEventId === row.catchEventId) return n;
  }
  return null;
}

function step3CatchDetailStrings(data: CatchData, events: TripEvent[]): {
  species: string;
  size: string;
  fly: string;
} {
  const { fly_pattern, fly_size, fly_color } = getFlyForCatch(data, events);
  const fly =
    fly_pattern?.trim()
      ? [fly_pattern.trim(), fly_size != null ? `#${fly_size}` : null, fly_color?.trim() || null]
          .filter(Boolean)
          .join(' ')
      : '—';
  const species = data.species?.trim() || '—';
  const size =
    data.size_inches != null && Number.isFinite(Number(data.size_inches))
      ? `${data.size_inches}"`
      : '—';
  return { species, size, fly };
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    header: {
      backgroundColor: '#2C4670',
      paddingBottom: Spacing.sm,
      paddingHorizontal: Spacing.md,
    },
    headerNavRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      marginBottom: Spacing.sm,
    },
    headerNavSide: { flex: 1, minWidth: 0 },
    headerNavSideStart: { alignItems: 'flex-start', justifyContent: 'center' },
    headerNavSideEnd: { alignItems: 'flex-end' },
    headerTitleInBar: {
      flex: 2,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.xs,
    },
    backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: Spacing.sm },
    backText: { color: '#fff', fontSize: FontSize.md },
    title: {
      color: '#fff',
      fontSize: FontSize.lg,
      fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
      fontWeight: '600',
      textAlign: 'center',
    },
    subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: FontSize.sm, marginTop: Spacing.xs },
    progressBar: {
      height: 4,
      backgroundColor: 'rgba(255,255,255,0.2)',
      borderRadius: 2,
      marginTop: Spacing.md,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', backgroundColor: colors.primary },
    stepRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.md },
    stepDot: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: 'rgba(255,255,255,0.2)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepDotActive: { backgroundColor: colors.primary },
    stepDotDone: { backgroundColor: colors.primary },
    stepDotText: { color: '#fff', fontSize: FontSize.xs, fontWeight: '700' },
    body: { flex: 1, paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
    },
    cardDashed: {
      borderStyle: 'dashed',
      alignItems: 'center',
      paddingVertical: Spacing.xxl,
    },
    uploadPickerCard: {
      borderStyle: 'dashed',
      alignItems: 'center',
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
    },
    step1PhotoGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: Spacing.sm,
    },
    step1ThumbFrame: {
      borderRadius: BorderRadius.md,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    step1DateOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingVertical: 5,
      paddingHorizontal: Spacing.xs,
      backgroundColor: 'rgba(0,0,0,0.62)',
    },
    step1DateOverlayText: {
      color: '#fff',
      fontSize: FontSize.xs,
      fontWeight: '600',
      textAlign: 'center',
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
      alignItems: 'center',
      marginTop: Spacing.lg,
    },
    primaryBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: FontSize.md },
    secondaryBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
      alignItems: 'center',
      flex: 1,
    },
    muted: { color: colors.textSecondary, fontSize: FontSize.sm, marginTop: Spacing.sm },
    thumb: { width: 64, height: 64, borderRadius: BorderRadius.sm, marginRight: Spacing.sm },
    step3CatchThumbStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: Spacing.sm,
    },
    step3CatchThumbCell: {
      position: 'relative',
      width: 36,
      height: 36,
      borderRadius: BorderRadius.sm,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    step3CatchThumbImg: {
      width: 36,
      height: 36,
    },
    step3CatchThumbOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    step3CatchThumbMoreText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '800',
    },
    thumbRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: Spacing.md },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    dropdownField: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    dropdownFieldInner: { flex: 1, minWidth: 0 },
    dropdownFieldLabel: { color: colors.textSecondary, fontSize: FontSize.xs },
    dropdownFieldValue: { color: colors.text, fontSize: FontSize.md, marginTop: 2 },
    tripMetaRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      alignItems: 'stretch',
      marginBottom: Spacing.sm,
    },
    dropdownFieldCompact: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.sm,
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.xs,
    },
    dropdownFieldCompactFlex: { flex: 1, minWidth: 0 },
    dropdownFieldLabelCompact: { color: colors.textSecondary, fontSize: FontSize.xs },
    dropdownFieldValueCompact: { color: colors.text, fontSize: FontSize.sm, marginTop: 1 },
    chip: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 4,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.background,
      marginRight: Spacing.xs,
      marginBottom: Spacing.xs,
    },
    chipActive: { backgroundColor: colors.primary + '33' },
    fishSceneryToggle: {
      flexDirection: 'row',
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: Spacing.sm,
    },
    fishSceneryToggleHalf: {
      flex: 1,
      paddingVertical: Spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fishSceneryToggleHalfActive: {
      backgroundColor: colors.primary + '28',
    },
    fishSceneryToggleLabel: { fontSize: FontSize.sm, fontWeight: '600' },
    fishSceneryToggleLabelActive: { color: colors.primary },
    fishSceneryToggleLabelIdle: { color: colors.textSecondary },
    step3CatchDetailBlock: { marginBottom: Spacing.sm, gap: 6 },
    step3CatchDetailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
    step3CatchDetailLabel: {
      width: 56,
      color: colors.textSecondary,
      fontSize: FontSize.xs,
      fontWeight: '600',
      paddingTop: 2,
    },
    step3CatchDetailValue: { flex: 1, color: colors.text, fontSize: FontSize.sm },
    wizardFooter: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      backgroundColor: colors.surface,
    },
    wizardFooterRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  });
}

type ImportPastTripStyles = ReturnType<typeof createStyles>;

function Step3CatchDetailsSummary({
  catchEvent,
  events,
  styles,
}: {
  catchEvent: TripEvent | undefined;
  events: TripEvent[];
  styles: ImportPastTripStyles;
}) {
  let species = '—';
  let size = '—';
  let fly = '—';
  if (catchEvent && catchEvent.event_type === 'catch') {
    const d = catchEvent.data as CatchData;
    const s = step3CatchDetailStrings(d, events);
    species = s.species;
    size = s.size;
    fly = s.fly;
  }
  return (
    <View style={styles.step3CatchDetailBlock}>
      <View style={styles.step3CatchDetailRow}>
        <Text style={styles.step3CatchDetailLabel}>Species</Text>
        <Text style={styles.step3CatchDetailValue} numberOfLines={3}>
          {species}
        </Text>
      </View>
      <View style={styles.step3CatchDetailRow}>
        <Text style={styles.step3CatchDetailLabel}>Size</Text>
        <Text style={styles.step3CatchDetailValue} numberOfLines={2}>
          {size}
        </Text>
      </View>
      <View style={styles.step3CatchDetailRow}>
        <Text style={styles.step3CatchDetailLabel}>Fly</Text>
        <Text style={styles.step3CatchDetailValue} numberOfLines={4}>
          {fly}
        </Text>
      </View>
    </View>
  );
}

export default function ImportPastTripsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  /** Step 1: 3 columns, tight gutters; matches `styles.body` horizontal padding. */
  const step1Grid = useMemo(() => {
    const bodyPadH = Spacing.lg * 2;
    const gap = 6;
    const inner = Math.max(0, windowWidth - bodyPadH);
    const cell = Math.max(72, Math.floor((inner - gap * 2) / 3));
    return { cell, gap };
  }, [windowWidth]);
  const { user, profile } = useAuthStore();
  const { isConnected } = useNetworkStatus();

  const step = useImportPastTripsStore((s) => s.step);
  const setStep = useImportPastTripsStore((s) => s.setStep);
  const reset = useImportPastTripsStore((s) => s.reset);
  const photos = useImportPastTripsStore((s) => s.photos);
  const groups = useImportPastTripsStore((s) => s.groups);
  const appendPhotos = useImportPastTripsStore((s) => s.appendPhotos);
  const prepareStep2FromPhotos = useImportPastTripsStore((s) => s.prepareStep2FromPhotos);
  const splitGroup = useImportPastTripsStore((s) => s.splitGroup);
  const mergeIntoGroup = useImportPastTripsStore((s) => s.mergeIntoGroup);
  const setGroupTripDate = useImportPastTripsStore((s) => s.setGroupTripDate);
  const setGroupLocation = useImportPastTripsStore((s) => s.setGroupLocation);
  const selectedPhotoIdsForAction = useImportPastTripsStore((s) => s.selectedPhotoIdsForAction);
  const togglePhotoSelectForCombine = useImportPastTripsStore((s) => s.togglePhotoSelectForCombine);
  const clearPhotoSelection = useImportPastTripsStore((s) => s.clearPhotoSelection);
  const setImportPhotoScenery = useImportPastTripsStore((s) => s.setImportPhotoScenery);
  const addCatchFromPayload = useImportPastTripsStore((s) => s.addCatchFromPayload);
  const addMinimalCatchForPhotoIds = useImportPastTripsStore((s) => s.addMinimalCatchForPhotoIds);
  const materializeMinimalCatchesForAllGroups = useImportPastTripsStore(
    (s) => s.materializeMinimalCatchesForAllGroups,
  );
  const updateGroupEventsAfterEdit = useImportPastTripsStore((s) => s.updateGroupEventsAfterEdit);
  const activeGroupIdForStep4 = useImportPastTripsStore((s) => s.activeGroupIdForStep4);
  const setActiveGroupForStep4 = useImportPastTripsStore((s) => s.setActiveGroupForStep4);

  const [picking, setPicking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [userFlies, setUserFlies] = useState<Fly[]>([]);
  const [locModalVisible, setLocModalVisible] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locCandidates, setLocCandidates] = useState<NearbyLocationResult[]>([]);
  const [locTargetGroupId, setLocTargetGroupId] = useState<string | null>(null);
  const [locAnchor, setLocAnchor] = useState<{ lat: number; lng: number } | null>(null);
  const [splitModalGroupId, setSplitModalGroupId] = useState<string | null>(null);
  const [splitSelected, setSplitSelected] = useState<Set<string>>(() => new Set());
  const [mergeModalSourceId, setMergeModalSourceId] = useState<string | null>(null);
  const [datePickerGroupId, setDatePickerGroupId] = useState<string | null>(null);
  const [catchUi, setCatchUi] = useState<
    | null
    | {
        groupId: string;
        mode: 'add' | 'edit';
        photoIds: string[];
        editingEvent: TripEvent | null;
      }
  >(null);

  useEffect(() => {
    if (user?.id) fetchFlies(user.id).then(setUserFlies).catch(() => setUserFlies([]));
  }, [user?.id]);

  useEffect(() => {
    if (step === 3 && groups.length > 0 && !activeGroupIdForStep4) {
      setActiveGroupForStep4(groups[0].id);
    }
  }, [step, groups, activeGroupIdForStep4, setActiveGroupForStep4]);

  const progress = (step / TOTAL_STEPS) * 100;
  const fishingType = profile?.preferred_fishing_type ?? 'fly';

  const openLocationPickerForGroup = useCallback(
    async (groupId: string) => {
      const g = groups.find((x) => x.id === groupId);
      if (!g) return;
      let anchor = computeAnchor(g.photoIds, photos);
      if (!anchor) {
        try {
          const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await ExpoLocation.getCurrentPositionAsync({
              accuracy: ExpoLocation.Accuracy.Balanced,
            });
            anchor = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          }
        } catch {
          /* */
        }
      }
      if (!anchor) {
        Alert.alert(
          'No location',
          'Add GPS to photos or enable location permission to find nearby waters.',
        );
        return;
      }
      setLocTargetGroupId(groupId);
      setLocAnchor(anchor);
      setLocModalVisible(true);
      setLocLoading(true);
      setLocCandidates([]);
      try {
        const rows = await searchNearbyRootParentCandidates(anchor.lat, anchor.lng);
        setLocCandidates(rows);
      } catch {
        setLocCandidates([]);
      } finally {
        setLocLoading(false);
      }
    },
    [groups, photos],
  );

  const onConfirmLocation = useCallback(
    (c: NearbyLocationResult) => {
      if (!locTargetGroupId) return;
      const gid = locTargetGroupId;
      const loc = nearbyResultToLocation(c);
      setGroupLocation(gid, loc, loc.id);
      setLocModalVisible(false);
      setLocTargetGroupId(null);
    },
    [locTargetGroupId, setGroupLocation],
  );

  const pickPhotos = useCallback(async () => {
    setPicking(true);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission', 'Photo library access is needed to import trips.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.9,
        exif: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const next: ImportPhoto[] = result.assets.map((asset) => ({
        id: uuidv4(),
        uri: asset.uri,
        meta: extractPhotoMetadataFromPickerAsset(asset),
      }));
      appendPhotos(next);
    } finally {
      setPicking(false);
    }
  }, [appendPhotos]);

  const draftTripForModal = useMemo(() => {
    if (!catchUi || !user?.id) return null;
    const g = groups.find((x) => x.id === catchUi.groupId);
    if (!g || !g.location) return null;
    return buildCompletedTripForImport(g, photos, user.id, fishingType);
  }, [catchUi, groups, photos, user?.id, fishingType]);

  const draftEventsForModal = useMemo(() => {
    if (!catchUi) return [];
    const g = groups.find((x) => x.id === catchUi.groupId);
    return g?.events ?? [];
  }, [catchUi, groups]);

  const seedPrimaryForModal = useMemo(() => {
    if (!catchUi) return null;
    const g = groups.find((x) => x.id === catchUi.groupId);
    return g?.currentPrimary ?? null;
  }, [catchUi, groups]);

  const seedDropperForModal = useMemo(() => {
    if (!catchUi) return null;
    const g = groups.find((x) => x.id === catchUi.groupId);
    return g?.currentDropper ?? null;
  }, [catchUi, groups]);

  const initialAddUris = useMemo(() => {
    if (!catchUi || catchUi.mode !== 'add') return undefined;
    return catchUi.photoIds.map((id) => photos.find((p) => p.id === id)?.uri).filter(Boolean) as string[];
  }, [catchUi, photos]);

  const goBackInWizard = useCallback(() => {
    if (step <= 1) {
      reset();
      router.back();
    } else {
      setStep(step - 1);
    }
  }, [step, reset, router, setStep]);

  const handleImportAll = useCallback(async () => {
    if (!user?.id) return;
    materializeMinimalCatchesForAllGroups();
    const freshGroups = useImportPastTripsStore.getState().groups;
    if (!step4Valid(freshGroups)) {
      Alert.alert('Incomplete', 'Mark each photo as scenery or fish before importing.');
      return;
    }
    setImporting(true);
    try {
      for (const g of freshGroups) {
        const res = await finalizeImportGroup(g, photos, user.id, fishingType, isConnected);
        if (!res.ok) {
          Alert.alert('Import', res.message);
          setImporting(false);
          return;
        }
      }
      reset();
      router.replace('/journal');
    } catch (e) {
      Alert.alert('Import', (e as Error).message);
    } finally {
      setImporting(false);
    }
  }, [
    user?.id,
    photos,
    fishingType,
    isConnected,
    reset,
    router,
    materializeMinimalCatchesForAllGroups,
  ]);

  const renderStep1 = () => (
    <>
      <Pressable style={[styles.card, styles.uploadPickerCard]} onPress={() => void pickPhotos()} disabled={picking}>
        {picking ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <MaterialIcons name="cloud-upload" size={28} color={colors.primary} />
            <Text
              style={{
                color: colors.text,
                fontWeight: '700',
                marginTop: Spacing.sm,
                fontSize: FontSize.md,
              }}
            >
              Upload photos
            </Text>
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: FontSize.xs,
                marginTop: Spacing.xs,
                textAlign: 'center',
              }}
            >
              From your library · dates from photo metadata when available
            </Text>
          </>
        )}
      </Pressable>
      {photos.length > 0 ? (
        <>
          <Text style={{ color: colors.textSecondary, marginTop: Spacing.md, fontSize: FontSize.sm }}>
            {photos.length} photo{photos.length !== 1 ? 's' : ''} selected
          </Text>
          <View style={[styles.step1PhotoGrid, { gap: step1Grid.gap }]}>
            {photos.map((p) => (
              <View key={p.id} style={{ width: step1Grid.cell }}>
                <View
                  style={[
                    styles.step1ThumbFrame,
                    { width: step1Grid.cell, height: step1Grid.cell },
                  ]}
                >
                  <Image
                    source={{ uri: p.uri }}
                    style={{ width: step1Grid.cell, height: step1Grid.cell }}
                  />
                  <View style={styles.step1DateOverlay}>
                    <Text style={styles.step1DateOverlayText} numberOfLines={1}>
                      {formatPhotoTakenLabel(p.meta.takenAt)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </>
  );

  const renderStep2 = () => (
    <>
      <Text style={{ color: colors.textSecondary, marginBottom: Spacing.md }}>
        Photos are grouped by date. Use Split or Combine to fix trips, set each date, and choose where you fished. Trip
        notes are not imported.
      </Text>
      {groups.map((g) => {
        const canSplit = g.photoIds.length > 1;
        const canMerge = groups.length > 1;
        const showActions = canSplit || canMerge;
        return (
          <View key={g.id} style={styles.card}>
            <View style={styles.tripMetaRow}>
              <Pressable
                onPress={() => setDatePickerGroupId((cur) => (cur === g.id ? null : g.id))}
                style={[styles.dropdownFieldCompact, styles.dropdownFieldCompactFlex]}
              >
                <View style={styles.dropdownFieldInner}>
                  <Text style={styles.dropdownFieldLabelCompact}>Date</Text>
                  <Text style={styles.dropdownFieldValueCompact} numberOfLines={1}>
                    {groupDisplayLabel(g.tripDateKey, photos, g.photoIds)}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                style={[styles.dropdownFieldCompact, styles.dropdownFieldCompactFlex]}
                onPress={() => void openLocationPickerForGroup(g.id)}
              >
                <View style={styles.dropdownFieldInner}>
                  <Text style={styles.dropdownFieldLabelCompact}>Location</Text>
                  <Text
                    style={[
                      styles.dropdownFieldValueCompact,
                      !g.location && { color: colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {g.location?.name ?? 'Choose location'}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
            {datePickerGroupId === g.id ? (
              <DateTimePicker
                value={parseISO(`${g.tripDateKey}T12:00:00`)}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(ev: DateTimePickerEvent, date?: Date) => {
                  if (Platform.OS === 'android') setDatePickerGroupId(null);
                  if (ev.type === 'dismissed' && Platform.OS === 'android') return;
                  if (date) setGroupTripDate(g.id, format(date, 'yyyy-MM-dd'));
                }}
              />
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: Spacing.xs }}>
              <View style={{ flexDirection: 'row' }}>
                {g.photoIds.map((pid) => {
                  const ph = photos.find((p) => p.id === pid);
                  return ph ? <Image key={pid} source={{ uri: ph.uri }} style={styles.thumb} /> : null;
                })}
              </View>
            </ScrollView>
            {showActions ? (
              <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md }}>
                {canSplit ? (
                  <Pressable
                    style={[styles.secondaryBtn, { flex: 1 }]}
                    onPress={() => {
                      setSplitModalGroupId(g.id);
                      setSplitSelected(new Set());
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>Split</Text>
                  </Pressable>
                ) : null}
                {canMerge ? (
                  <Pressable
                    style={[styles.secondaryBtn, { flex: 1 }]}
                    onPress={() => setMergeModalSourceId(g.id)}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>Combine</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </>
  );

  const activeGroup = groups.find((g) => g.id === activeGroupIdForStep4);
  const step3CombineEnabled =
    activeGroup != null &&
    activeGroup.photoIds.length > 1 &&
    selectedPhotoIdsForAction.length >= 2 &&
    selectedPhotoIdsForAction.every((pid) => {
      const st = activeGroup.photoStates[pid];
      return !st || st.kind === 'untagged';
    });

  const renderStep3 = () => (
    <>
      <Text style={{ color: colors.textSecondary, marginBottom: Spacing.md }}>
        Mark Scenery vs Fish. Fish become photo-only catches when you tap Review (no form). Optional: Edit details anytime.
        Select two or more untagged fish, then Combine selected to merge into one catch.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.md }}>
        <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
          {groups.map((g) => (
            <Pressable
              key={g.id}
              style={[styles.chip, activeGroupIdForStep4 === g.id && styles.chipActive]}
              onPress={() => setActiveGroupForStep4(g.id)}
            >
              <Text style={{ color: colors.text, fontSize: FontSize.sm }}>
                {groupDisplayLabel(g.tripDateKey, photos, g.photoIds)}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      {!activeGroup ? null : (
        <>
          {buildStep3Rows(activeGroup).map((row) => {
            if (row.kind === 'scenery') {
              const pid = row.photoId;
              const ph = photos.find((p) => p.id === pid);
              const selected = selectedPhotoIdsForAction.includes(pid);
              const isScenery = true;
              return (
                <View
                  key={pid}
                  style={[
                    styles.card,
                    {
                      paddingVertical: Spacing.sm,
                      paddingHorizontal: Spacing.md,
                    },
                    selected && { borderColor: colors.primary },
                  ]}
                >
                  <View style={styles.fishSceneryToggle}>
                    <Pressable
                      style={[
                        styles.fishSceneryToggleHalf,
                        !isScenery && styles.fishSceneryToggleHalfActive,
                      ]}
                      onPress={() => setImportPhotoScenery(activeGroup.id, pid, false)}
                    >
                      <Text
                        style={[
                          styles.fishSceneryToggleLabel,
                          !isScenery ? styles.fishSceneryToggleLabelActive : styles.fishSceneryToggleLabelIdle,
                        ]}
                      >
                        Fish
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.fishSceneryToggleHalf,
                        isScenery && styles.fishSceneryToggleHalfActive,
                      ]}
                      onPress={() => setImportPhotoScenery(activeGroup.id, pid, true)}
                    >
                      <Text
                        style={[
                          styles.fishSceneryToggleLabel,
                          isScenery ? styles.fishSceneryToggleLabelActive : styles.fishSceneryToggleLabelIdle,
                        ]}
                      >
                        Scenery
                      </Text>
                    </Pressable>
                  </View>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: Spacing.sm,
                    }}
                  >
                    <Pressable
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 }}
                      onPress={() => togglePhotoSelectForCombine(pid)}
                    >
                      {ph ? <Image source={{ uri: ph.uri }} style={styles.thumb} /> : null}
                      <View style={{ flex: 1, minWidth: 0, marginLeft: ph ? Spacing.sm : 0 }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>Scenery</Text>
                        <Text style={styles.muted}>Not a catch photo</Text>
                      </View>
                    </Pressable>
                  </View>
                </View>
              );
            }

            if (row.kind === 'untagged') {
              const pid = row.photoId;
              const ph = photos.find((p) => p.id === pid);
              const selected = selectedPhotoIdsForAction.includes(pid);
              const fishN = step3FishOrdinalForRow(activeGroup, row);
              const headerLabel = fishN != null ? `Fish ${fishN}` : 'Fish';
              const openEditDetails = () => {
                setCatchUi({
                  groupId: activeGroup.id,
                  mode: 'add',
                  photoIds: [pid],
                  editingEvent: null,
                });
              };
              return (
                <View
                  key={pid}
                  style={[
                    styles.card,
                    {
                      paddingVertical: Spacing.sm,
                      paddingHorizontal: Spacing.md,
                    },
                    selected && { borderColor: colors.primary },
                  ]}
                >
                  <View style={styles.fishSceneryToggle}>
                    <Pressable
                      style={[styles.fishSceneryToggleHalf, styles.fishSceneryToggleHalfActive]}
                      onPress={() => setImportPhotoScenery(activeGroup.id, pid, false)}
                    >
                      <Text
                        style={[styles.fishSceneryToggleLabel, styles.fishSceneryToggleLabelActive]}
                      >
                        Fish
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.fishSceneryToggleHalf]}
                      onPress={() => setImportPhotoScenery(activeGroup.id, pid, true)}
                    >
                      <Text
                        style={[styles.fishSceneryToggleLabel, styles.fishSceneryToggleLabelIdle]}
                      >
                        Scenery
                      </Text>
                    </Pressable>
                  </View>
                  <Step3CatchDetailsSummary catchEvent={undefined} events={activeGroup.events} styles={styles} />
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: Spacing.sm,
                    }}
                  >
                    <Pressable
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 }}
                      onPress={() => togglePhotoSelectForCombine(pid)}
                    >
                      {ph ? <Image source={{ uri: ph.uri }} style={styles.thumb} /> : null}
                      <View style={{ flex: 1, minWidth: 0, marginLeft: ph ? Spacing.sm : 0 }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>{headerLabel}</Text>
                        <Text style={[styles.muted, { marginTop: Spacing.xs }]}>Edit details to change</Text>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={openEditDetails}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    >
                      <Text style={{ color: colors.primary, fontWeight: '600', fontSize: FontSize.sm }}>
                        Edit details
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            }

            const { catchEventId, photoIds } = row;
            const ev = activeGroup.events.find(
              (e) => e.event_type === 'catch' && e.id === catchEventId,
            );
            const fishN = step3FishOrdinalForRow(activeGroup, row);
            const headerLabel = fishN != null ? `Fish ${fishN}` : 'Fish';
            const openEditDetails = () => {
              if (ev) {
                setCatchUi({
                  groupId: activeGroup.id,
                  mode: 'edit',
                  photoIds,
                  editingEvent: ev,
                });
              }
            };
            const cardSelected = photoIds.some((id) => selectedPhotoIdsForAction.includes(id));

            if (photoIds.length === 1) {
              const pid = photoIds[0];
              const ph = photos.find((p) => p.id === pid);
              return (
                <View
                  key={pid}
                  style={[
                    styles.card,
                    {
                      paddingVertical: Spacing.sm,
                      paddingHorizontal: Spacing.md,
                    },
                  ]}
                >
                  <View style={styles.fishSceneryToggle}>
                    <Pressable
                      style={[styles.fishSceneryToggleHalf, styles.fishSceneryToggleHalfActive]}
                      onPress={() => setImportPhotoScenery(activeGroup.id, pid, false)}
                    >
                      <Text
                        style={[styles.fishSceneryToggleLabel, styles.fishSceneryToggleLabelActive]}
                      >
                        Fish
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.fishSceneryToggleHalf]}
                      onPress={() => setImportPhotoScenery(activeGroup.id, pid, true)}
                    >
                      <Text
                        style={[styles.fishSceneryToggleLabel, styles.fishSceneryToggleLabelIdle]}
                      >
                        Scenery
                      </Text>
                    </Pressable>
                  </View>
                  <Step3CatchDetailsSummary catchEvent={ev} events={activeGroup.events} styles={styles} />
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: Spacing.sm,
                    }}
                  >
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
                      {ph ? <Image source={{ uri: ph.uri }} style={styles.thumb} /> : null}
                      <View style={{ flex: 1, minWidth: 0, marginLeft: ph ? Spacing.sm : 0 }}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>{headerLabel}</Text>
                        <Text style={[styles.muted, { marginTop: Spacing.xs }]}>Edit details to change</Text>
                      </View>
                    </View>
                    <Pressable
                      onPress={openEditDetails}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    >
                      <Text style={{ color: colors.primary, fontWeight: '600', fontSize: FontSize.sm }}>
                        Edit details
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            }

            return (
              <View
                key={catchEventId}
                style={[
                  styles.card,
                  {
                    paddingVertical: Spacing.sm,
                    paddingHorizontal: Spacing.md,
                  },
                  cardSelected && { borderColor: colors.primary },
                ]}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: Spacing.sm,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{headerLabel}</Text>
                  <Pressable
                    onPress={openEditDetails}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  >
                    <Text style={{ color: colors.primary, fontWeight: '600', fontSize: FontSize.sm }}>
                      Edit details
                    </Text>
                  </Pressable>
                </View>
                <Step3CatchDetailsSummary catchEvent={ev} events={activeGroup.events} styles={styles} />
                <View style={styles.step3CatchThumbStrip}>
                  {(() => {
                    const n = photoIds.length;
                    const showPlusOnFourth = n > 4;
                    const extraCount = n - 4;
                    const slots = Math.min(4, n);
                    return Array.from({ length: slots }, (_, i) => {
                      const pid = photoIds[i];
                      const ph = photos.find((p) => p.id === pid);
                      const showOverlay = showPlusOnFourth && i === 3;
                      return (
                        <View key={pid} style={styles.step3CatchThumbCell}>
                          {ph ? (
                            <Image source={{ uri: ph.uri }} style={styles.step3CatchThumbImg} />
                          ) : null}
                          {showOverlay ? (
                            <View style={styles.step3CatchThumbOverlay} pointerEvents="none">
                              <Text style={styles.step3CatchThumbMoreText}>+{extraCount}</Text>
                            </View>
                          ) : null}
                        </View>
                      );
                    });
                  })()}
                </View>
              </View>
            );
          })}
          {activeGroup.photoIds.length > 1 ? (
            <Pressable
              style={[
                styles.primaryBtn,
                { marginTop: Spacing.md },
                !step3CombineEnabled ? { opacity: 0.4 } : null,
              ]}
              disabled={!step3CombineEnabled}
              onPress={() => {
                const sel = selectedPhotoIdsForAction.filter((pid) => {
                  const st = activeGroup.photoStates[pid];
                  return !st || st.kind === 'untagged';
                });
                if (sel.length < 2) {
                  Alert.alert('Combine', 'Select at least two untagged fish photos.');
                  return;
                }
                addMinimalCatchForPhotoIds(activeGroup.id, sel);
              }}
            >
              <Text style={styles.primaryBtnText}>Combine selected</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </>
  );

  const totalCatches = groups.reduce(
    (n, g) => n + g.events.filter((e) => e.event_type === 'catch').length,
    0,
  );

  const renderStep4 = () => (
    <>
      <Text style={{ color: colors.textSecondary, marginBottom: Spacing.md }}>Review before importing.</Text>
      <View style={{ flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg }}>
        <View style={[styles.card, { flex: 1, alignItems: 'center' }]}>
          <Text style={{ color: colors.primary, fontSize: FontSize.xl, fontWeight: '800' }}>{groups.length}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: FontSize.xs }}>Trips</Text>
        </View>
        <View style={[styles.card, { flex: 1, alignItems: 'center' }]}>
          <Text style={{ color: colors.primary, fontSize: FontSize.xl, fontWeight: '800' }}>{photos.length}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: FontSize.xs }}>Photos</Text>
        </View>
        <View style={[styles.card, { flex: 1, alignItems: 'center' }]}>
          <Text style={{ color: colors.primary, fontSize: FontSize.xl, fontWeight: '800' }}>{totalCatches}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: FontSize.xs }}>Catches</Text>
        </View>
      </View>
      {groups.map((g) => (
        <View key={g.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
              {g.location?.name ?? 'Trip'}
            </Text>
            <Text style={{ color: colors.primary, fontSize: FontSize.sm }}>
              {g.events.filter((e) => e.event_type === 'catch').length} catches
            </Text>
          </View>
          <Text style={styles.muted}>{groupDisplayLabel(g.tripDateKey, photos, g.photoIds)}</Text>
          <ScrollView horizontal style={{ marginTop: Spacing.sm }}>
            <View style={{ flexDirection: 'row' }}>
              {g.photoIds.map((pid) => {
                const ph = photos.find((p) => p.id === pid);
                return ph ? <Image key={pid} source={{ uri: ph.uri }} style={styles.thumb} /> : null;
              })}
            </View>
          </ScrollView>
        </View>
      ))}
    </>
  );

  const renderWizardFooter = () => (
    <View style={[styles.wizardFooter, { paddingBottom: Spacing.md + insets.bottom }]}>
      <View style={styles.wizardFooterRow}>
        <Pressable style={[styles.secondaryBtn, { marginTop: 0, flex: 1 }]} onPress={goBackInWizard}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>Back</Text>
        </Pressable>
        {step === 1 ? (
          <Pressable
            style={[
              styles.primaryBtn,
              { flex: 2, marginTop: 0 },
              photos.length === 0 && { opacity: 0.5 },
            ]}
            disabled={photos.length === 0 || picking}
            onPress={() => {
              prepareStep2FromPhotos();
              setStep(2);
            }}
          >
            <Text style={styles.primaryBtnText}>Next</Text>
          </Pressable>
        ) : null}
        {step === 2 ? (
          <Pressable
            style={[styles.primaryBtn, { flex: 2, marginTop: 0 }]}
            onPress={() => {
              if (!step3Valid(groups)) {
                Alert.alert('Location required', 'Choose a location for every trip.');
                return;
              }
              setStep(3);
            }}
          >
            <Text style={styles.primaryBtnText}>Next</Text>
          </Pressable>
        ) : null}
        {step === 3 ? (
          <Pressable
            style={[styles.primaryBtn, { flex: 2, marginTop: 0 }]}
            onPress={() => {
              materializeMinimalCatchesForAllGroups();
              const nextGroups = useImportPastTripsStore.getState().groups;
              if (!step4Valid(nextGroups)) {
                Alert.alert('Tag photos', 'Every photo must be scenery or a catch.');
                return;
              }
              setStep(4);
            }}
          >
            <Text style={styles.primaryBtnText}>Review</Text>
          </Pressable>
        ) : null}
        {step === 4 ? (
          <Pressable
            style={[styles.primaryBtn, { flex: 2, marginTop: 0 }]}
            onPress={() => void handleImportAll()}
            disabled={importing}
          >
            {importing ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.primaryBtnText}>
                Import {groups.length} trip{groups.length !== 1 ? 's' : ''}
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerNavRow}>
          <View style={[styles.headerNavSide, styles.headerNavSideStart]}>
            <Pressable style={styles.backBtn} onPress={goBackInWizard}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          </View>
          <View style={styles.headerTitleInBar} pointerEvents="none">
            <Text style={styles.title} numberOfLines={1}>
              Import Past Trips
            </Text>
          </View>
          <View style={[styles.headerNavSide, styles.headerNavSideEnd]} />
        </View>
        <Text style={styles.subtitle}>
          Step {step} of {TOTAL_STEPS}: {STEP_TITLES[step - 1]}
        </Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <View style={styles.stepRow}>
          {[1, 2, 3, 4].map((n) => (
            <View
              key={n}
              style={[
                styles.stepDot,
                n === step && styles.stepDotActive,
                n < step && styles.stepDotDone,
              ]}
            >
              <Text style={styles.stepDotText}>{n < step ? '✓' : n}</Text>
            </View>
          ))}
        </View>
      </View>

      <ScrollView
        style={[styles.body, { flex: 1 }]}
        contentContainerStyle={{ paddingBottom: Spacing.xxl + Spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </ScrollView>

      {renderWizardFooter()}

      <NearbyRootLocationPickerModal
        visible={locModalVisible}
        onClose={() => {
          setLocModalVisible(false);
          setLocTargetGroupId(null);
        }}
        candidates={locCandidates}
        loading={locLoading}
        anchorLat={locAnchor?.lat ?? null}
        anchorLng={locAnchor?.lng ?? null}
        onPick={(c) => void onConfirmLocation(c)}
      />

      <Modal visible={splitModalGroupId != null} transparent animationType="fade">
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: Spacing.lg }}
          onPress={() => setSplitModalGroupId(null)}
        >
          <Pressable
            style={{ backgroundColor: colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: Spacing.md }}>Move photos to new trip</Text>
            {splitModalGroupId
              ? (() => {
                  const g = groups.find((x) => x.id === splitModalGroupId);
                  if (!g) return null;
                  return g.photoIds.map((pid) => {
                    const ph = photos.find((p) => p.id === pid);
                    const on = splitSelected.has(pid);
                    return (
                      <Pressable
                        key={pid}
                        style={{ flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm }}
                        onPress={() => {
                          setSplitSelected((prev) => {
                            const n = new Set(prev);
                            if (n.has(pid)) n.delete(pid);
                            else n.add(pid);
                            return n;
                          });
                        }}
                      >
                        <View
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 4,
                            borderWidth: 2,
                            borderColor: colors.primary,
                            backgroundColor: on ? colors.primary : 'transparent',
                            marginRight: Spacing.sm,
                          }}
                        />
                        {ph ? <Image source={{ uri: ph.uri }} style={{ width: 40, height: 40, borderRadius: 4 }} /> : null}
                      </Pressable>
                    );
                  });
                })()
              : null}
            <Pressable
              style={[styles.primaryBtn, { marginTop: Spacing.md }]}
              onPress={() => {
                if (!splitModalGroupId) return;
                const ids = [...splitSelected];
                if (ids.length === 0) {
                  Alert.alert('Select photos', 'Pick at least one photo to move.');
                  return;
                }
                splitGroup(splitModalGroupId, ids);
                setSplitModalGroupId(null);
                setSplitSelected(new Set());
              }}
            >
              <Text style={styles.primaryBtnText}>Split into new trip</Text>
            </Pressable>
            <Pressable style={{ marginTop: Spacing.sm, alignItems: 'center' }} onPress={() => setSplitModalGroupId(null)}>
              <Text style={{ color: colors.textSecondary }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={mergeModalSourceId != null} transparent animationType="fade">
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: Spacing.lg }}
          onPress={() => setMergeModalSourceId(null)}
        >
          <Pressable
            style={{ backgroundColor: colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, maxHeight: '80%' }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: Spacing.xs }}>Combine with which trip?</Text>
            <Text style={[styles.muted, { marginBottom: Spacing.md }]}>
              All photos from this trip are added to the one you select. Its date and location stay; you can adjust them next.
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {mergeModalSourceId
                ? groups
                    .filter((x) => x.id !== mergeModalSourceId)
                    .map((target) => (
                      <Pressable
                        key={target.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: Spacing.md,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                        }}
                        onPress={() => {
                          if (!mergeModalSourceId) return;
                          mergeIntoGroup(mergeModalSourceId, target.id);
                          setMergeModalSourceId(null);
                        }}
                      >
                        {(() => {
                          const thumbUri = target.photoIds[0]
                            ? photos.find((p) => p.id === target.photoIds[0])?.uri
                            : undefined;
                          return thumbUri ? (
                            <Image
                              source={{ uri: thumbUri }}
                              style={{ width: 44, height: 44, borderRadius: BorderRadius.sm, marginRight: Spacing.md }}
                            />
                          ) : (
                            <View style={{ width: 44, height: 44, marginRight: Spacing.md }} />
                          );
                        })()}
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '600' }}>
                            {groupDisplayLabel(target.tripDateKey, photos, target.photoIds)}
                          </Text>
                          <Text style={styles.muted}>
                            {target.photoIds.length} photo{target.photoIds.length !== 1 ? 's' : ''}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                      </Pressable>
                    ))
                : null}
            </ScrollView>
            <Pressable style={{ marginTop: Spacing.md, alignItems: 'center' }} onPress={() => setMergeModalSourceId(null)}>
              <Text style={{ color: colors.textSecondary }}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {draftTripForModal && user?.id && catchUi ? (
        <CatchDetailsModal
          visible
          onClose={() => setCatchUi(null)}
          mode={catchUi.mode}
          trip={draftTripForModal}
          userId={user.id}
          isConnected={isConnected}
          userFlies={userFlies}
          allEvents={draftEventsForModal}
          editingEvent={catchUi.mode === 'edit' ? catchUi.editingEvent : null}
          seedPrimary={seedPrimaryForModal ?? undefined}
          seedDropper={seedDropperForModal ?? undefined}
          deferCloudWrites={catchUi.mode === 'edit'}
          initialAddPhotoUris={initialAddUris}
          onSubmitAdd={async (payload: CatchDetailsSubmitAdd) => {
            addCatchFromPayload(catchUi.groupId, catchUi.photoIds, payload);
            setCatchUi(null);
          }}
          onSubmitEdit={async (nextEvents) => {
            updateGroupEventsAfterEdit(catchUi.groupId, nextEvents);
            setCatchUi(null);
          }}
        />
      ) : null}
    </View>
  );
}
