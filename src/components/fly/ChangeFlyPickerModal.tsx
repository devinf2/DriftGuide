import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { Fly, FlyCatalog, FlyChangeData, NextFlyRecommendation } from '@/src/types';
import { mergeTryNextWithSyntheticDropperIfMissing } from '@/src/services/ai';
import { fetchFliesOrCache } from '@/src/services/flyService';
import { AddFlySheet } from '@/src/components/fly/AddFlySheet';
import { FlyCatalogAddModal } from '@/src/components/fly/FlyCatalogAddModal';
import { FlyImageGrid, type FlyImageGridItem } from '@/src/components/fly/FlyImageGrid';
import { FlyImageTile } from '@/src/components/fly/FlyImageTile';
import { displayFlyName, isFlySelectionValid } from '@/src/utils/flyValidation';
import {
  isSameFlyChangeSelection,
  resolveUserBoxFlyIdForPicker,
  seedSelectionFromFlyChange,
} from '@/src/utils/flyPickerSelection';
import { flyToFlyChangeData, isUserFlyPhotoUrl, resolveFlyPhotoUrl } from '@/src/utils/resolveFlyPhotoUrl';

export { seedSelectionFromFlyChange } from '@/src/utils/flyPickerSelection';

function primaryFromRecommendation(rec: NextFlyRecommendation): FlyChangeData {
  return {
    pattern: rec.pattern,
    size: rec.size,
    color: rec.color,
    fly_id: rec.fly_id ?? undefined,
    fly_color_id: rec.fly_color_id ?? undefined,
    fly_size_id: rec.fly_size_id ?? undefined,
  };
}

export function dropperFromRecommendation(rec: NextFlyRecommendation): FlyChangeData | null {
  if (!rec.pattern2?.trim()) return null;
  return {
    pattern: rec.pattern2.trim(),
    size: rec.size2 ?? null,
    color: rec.color2 ?? null,
    fly_id: rec.fly_id2 ?? undefined,
    fly_color_id: rec.fly_color_id2 ?? undefined,
    fly_size_id: rec.fly_size_id2 ?? undefined,
  };
}

function buildRigSlotChipPreview(
  initial: FlyChangeData | null | undefined,
  pattern: string | null,
  size: number | null,
  color: string | null,
  userBoxFlyId: string | null,
  catalogFlyId: string | null,
  userFlies: Fly[],
  catalog: FlyCatalog[],
): { oldLabel: string | null; newLabel: string | null; showArrow: boolean } {
  const oldPat = initial?.pattern?.trim();
  const oldLabel = oldPat ? displayFlyName(oldPat) : null;

  const draftValid = isFlySelectionValid({
    pattern,
    size,
    color,
    userBoxFlyId,
    catalogFlyId,
  });
  const draftPat = pattern?.trim();
  const draft =
    draftValid && draftPat
      ? buildFlyChangeFromSelection(
          pattern,
          size,
          color,
          userBoxFlyId,
          catalogFlyId,
          userFlies,
          catalog,
        )
      : null;
  const newLabel = draftPat && draftValid ? displayFlyName(draftPat) : oldLabel;

  const showArrow = Boolean(
    draft &&
      newLabel &&
      (oldLabel ? !isSameFlyChangeSelection(draft, initial) : true),
  );

  return { oldLabel, newLabel, showArrow };
}

function buildFlyChangeFromSelection(
  pattern: string | null,
  size: number | null,
  color: string | null,
  userBoxFlyId: string | null,
  catalogFlyId: string | null,
  userFlies: Fly[],
  catalog: FlyCatalog[],
): FlyChangeData | null {
  if (!isFlySelectionValid({ pattern, size, color, userBoxFlyId, catalogFlyId })) {
    return null;
  }

  const fromBox = userBoxFlyId ? userFlies.find((f) => f.id === userBoxFlyId) : null;
  if (fromBox) return flyToFlyChangeData(fromBox, userFlies, catalog);

  const pat = pattern?.trim() || catalog.find((c) => c.id === catalogFlyId)?.name || '';
  const photoUrl = resolveFlyPhotoUrl(pat, size, color, userBoxFlyId, catalogFlyId, userFlies, catalog);
  return {
    pattern: pat,
    size,
    color,
    fly_id: catalogFlyId ?? undefined,
    user_fly_box_id: userBoxFlyId ?? undefined,
    photo_url: photoUrl,
  };
}

export function splitFlyChangeData(data: FlyChangeData): {
  primary: FlyChangeData;
  dropper: FlyChangeData | null;
} {
  const primary: FlyChangeData = {
    pattern: data.pattern,
    size: data.size,
    color: data.color,
    fly_id: data.fly_id,
    fly_color_id: data.fly_color_id,
    fly_size_id: data.fly_size_id,
    user_fly_box_id: data.user_fly_box_id,
    photo_url: data.photo_url,
  };
  const has2 = data.pattern2 != null && String(data.pattern2).trim().length > 0;
  if (!has2) return { primary, dropper: null };
  return {
    primary,
    dropper: {
      pattern: data.pattern2!,
      size: data.size2 ?? null,
      color: data.color2 ?? null,
      fly_id: data.fly_id2 ?? undefined,
      fly_color_id: data.fly_color_id2 ?? undefined,
      fly_size_id: data.fly_size_id2 ?? undefined,
      user_fly_box_id: data.user_fly_box_id2 ?? undefined,
      photo_url: data.photo_url2 ?? undefined,
    },
  };
}

export function mergeFlyPickerSelection(primary: FlyChangeData, dropper: FlyChangeData | null): FlyChangeData {
  return {
    pattern: primary.pattern,
    size: primary.size,
    color: primary.color,
    fly_id: primary.fly_id,
    fly_color_id: primary.fly_color_id,
    fly_size_id: primary.fly_size_id,
    user_fly_box_id: primary.user_fly_box_id,
    photo_url: primary.photo_url,
    ...(dropper
      ? {
          pattern2: dropper.pattern,
          size2: dropper.size ?? null,
          color2: dropper.color ?? null,
          fly_id2: dropper.fly_id ?? null,
          fly_color_id2: dropper.fly_color_id ?? null,
          fly_size_id2: dropper.fly_size_id ?? null,
          user_fly_box_id2: dropper.user_fly_box_id ?? null,
          photo_url2: dropper.photo_url ?? null,
        }
      : {}),
  };
}

export type ChangeFlyPickerModalProps = {
  visible: boolean;
  onClose: () => void;
  userFlies: Fly[];
  flyCatalog: FlyCatalog[];
  seedKey: string;
  initialPrimary: FlyChangeData | null;
  initialDropper: FlyChangeData | null;
  title?: string;
  onConfirm: (primary: FlyChangeData, dropper: FlyChangeData | null) => void;
  nextFlyRecommendation?: NextFlyRecommendation | null;
  recommendationLoading?: boolean;
  userId?: string;
  isConnected?: boolean;
  /** Active trip id when picking flies during a session (offline sync scope). */
  tripId?: string;
  onUserFliesUpdated?: (flies: Fly[]) => void;
  /** When set, only edit one rig slot; the other is preserved from initialPrimary / initialDropper. */
  singleEditSlot?: 'primary' | 'secondary' | null;
};

export function ChangeFlyPickerModal({
  visible,
  onClose,
  userFlies: userFliesProp,
  flyCatalog,
  seedKey,
  initialPrimary,
  initialDropper,
  title = 'Select Fly',
  onConfirm,
  nextFlyRecommendation = null,
  recommendationLoading = false,
  userId,
  isConnected = true,
  tripId,
  onUserFliesUpdated,
  singleEditSlot = null,
}: ChangeFlyPickerModalProps) {
  const { colors, resolvedScheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const scrim = resolvedScheme === 'dark' ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.52)';
  const styles = useMemo(() => createFlyPickerStyles(colors, scrim), [colors, scrim]);

  const [userFlies, setUserFlies] = useState(userFliesProp);
  const [pickerName, setPickerName] = useState<string | null>(null);
  const [pickerSize, setPickerSize] = useState<number | null>(null);
  const [pickerColor, setPickerColor] = useState<string | null>(null);
  const [primaryUserBoxFlyId, setPrimaryUserBoxFlyId] = useState<string | null>(null);
  const [primaryCatalogFlyId, setPrimaryCatalogFlyId] = useState<string | null>(null);

  const [pickerName2, setPickerName2] = useState<string | null>(null);
  const [pickerSize2, setPickerSize2] = useState<number | null>(null);
  const [pickerColor2, setPickerColor2] = useState<string | null>(null);
  const [dropperUserBoxFlyId, setDropperUserBoxFlyId] = useState<string | null>(null);
  const [dropperCatalogFlyId, setDropperCatalogFlyId] = useState<string | null>(null);

  const [activeSlot, setActiveSlot] = useState<'primary' | 'dropper'>('primary');
  const [flySearch, setFlySearch] = useState('');
  const [addFlyOpen, setAddFlyOpen] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [openAsCustom, setOpenAsCustom] = useState(false);
  const [initialCatalogFlyForAdd, setInitialCatalogFlyForAdd] = useState<FlyCatalog | null>(null);

  useEffect(() => {
    setUserFlies(userFliesProp);
  }, [userFliesProp]);

  useEffect(() => {
    if (!visible || !userId) return;
    let cancelled = false;
    void fetchFliesOrCache(userId).then((list) => {
      if (cancelled) return;
      setUserFlies(list);
      onUserFliesUpdated?.(list);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, userId, isConnected, onUserFliesUpdated]);

  useEffect(() => {
    if (!visible) return;
    const p = initialPrimary;
    setPickerName(p?.pattern?.trim() ? p.pattern.trim() : null);
    setPickerSize(p?.size ?? null);
    setPickerColor(p?.color ?? null);
    const ps = seedSelectionFromFlyChange(p, userFliesProp, flyCatalog);
    setPrimaryUserBoxFlyId(ps.userBoxId);
    setPrimaryCatalogFlyId(ps.catalogFlyId);

    const d = initialDropper;
    const addingSecondary =
      singleEditSlot === 'secondary' && !(d?.pattern != null && String(d.pattern).trim());
    if (singleEditSlot === 'primary') {
      setPickerName2(null);
      setPickerSize2(null);
      setPickerColor2(null);
      setDropperUserBoxFlyId(null);
      setDropperCatalogFlyId(null);
      setActiveSlot('primary');
    } else if (singleEditSlot === 'secondary') {
      if (d?.pattern != null && String(d.pattern).trim()) {
        setPickerName2(d.pattern.trim());
        setPickerSize2(d.size ?? null);
        setPickerColor2(d.color ?? null);
        const ds = seedSelectionFromFlyChange(d, userFliesProp, flyCatalog);
        setDropperUserBoxFlyId(ds.userBoxId);
        setDropperCatalogFlyId(ds.catalogFlyId);
      } else {
        setPickerName2('');
        setPickerSize2(null);
        setPickerColor2(null);
        setDropperUserBoxFlyId(null);
        setDropperCatalogFlyId(null);
      }
      setActiveSlot('dropper');
    } else if (d?.pattern != null && String(d.pattern).trim()) {
      setPickerName2(d.pattern.trim());
      setPickerSize2(d.size ?? null);
      setPickerColor2(d.color ?? null);
      const ds = seedSelectionFromFlyChange(d, userFliesProp, flyCatalog);
      setDropperUserBoxFlyId(ds.userBoxId);
      setDropperCatalogFlyId(ds.catalogFlyId);
      setActiveSlot('primary');
    } else if (addingSecondary) {
      setPickerName2('');
      setPickerSize2(null);
      setPickerColor2(null);
      setDropperUserBoxFlyId(null);
      setDropperCatalogFlyId(null);
      setActiveSlot('dropper');
    } else {
      setPickerName2(null);
      setPickerSize2(null);
      setPickerColor2(null);
      setDropperUserBoxFlyId(null);
      setDropperCatalogFlyId(null);
      setActiveSlot('primary');
    }
    setFlySearch('');
    setAddFlyOpen(false);
    setAddSheetOpen(false);
    setInitialCatalogFlyForAdd(null);
    setOpenAsCustom(false);
    // Intentionally omit userFliesProp — updating the box after "Add fly" must not re-seed and clear selection.
  }, [
    visible,
    seedKey,
    flyCatalog,
    singleEditSlot,
    initialPrimary?.pattern,
    initialPrimary?.size,
    initialPrimary?.color,
    initialPrimary?.fly_id,
    initialPrimary?.user_fly_box_id,
    initialDropper?.pattern,
    initialDropper?.size,
    initialDropper?.color,
    initialDropper?.fly_id,
    initialDropper?.user_fly_box_id,
  ]);

  useEffect(() => {
    if (!visible) return;
    const resolvedPrimaryId = resolveUserBoxFlyIdForPicker(
      primaryUserBoxFlyId,
      primaryCatalogFlyId,
      pickerName,
      pickerSize,
      pickerColor,
      userFlies,
      flyCatalog,
    );
    if (resolvedPrimaryId && resolvedPrimaryId !== primaryUserBoxFlyId) {
      setPrimaryUserBoxFlyId(resolvedPrimaryId);
      setPrimaryCatalogFlyId(null);
    }
    const resolvedDropperId = resolveUserBoxFlyIdForPicker(
      dropperUserBoxFlyId,
      dropperCatalogFlyId,
      pickerName2,
      pickerSize2,
      pickerColor2,
      userFlies,
      flyCatalog,
    );
    if (resolvedDropperId && resolvedDropperId !== dropperUserBoxFlyId) {
      setDropperUserBoxFlyId(resolvedDropperId);
      setDropperCatalogFlyId(null);
    }
  }, [
    visible,
    userFlies,
    flyCatalog,
    primaryUserBoxFlyId,
    primaryCatalogFlyId,
    pickerName,
    pickerSize,
    pickerColor,
    dropperUserBoxFlyId,
    dropperCatalogFlyId,
    pickerName2,
    pickerSize2,
    pickerColor2,
  ]);

  const dropperSectionOpen = singleEditSlot === 'secondary' ? true : pickerName2 !== null;
  const lockedSlot: 'primary' | 'dropper' | null =
    singleEditSlot === 'primary' ? 'primary' : singleEditSlot === 'secondary' ? 'dropper' : null;
  const effectiveActiveSlot = lockedSlot ?? activeSlot;

  const effectiveNextFlyRecommendation = useMemo(() => {
    if (!nextFlyRecommendation) return null;
    if (!dropperSectionOpen) return nextFlyRecommendation;
    return mergeTryNextWithSyntheticDropperIfMissing(nextFlyRecommendation, userFlies);
  }, [nextFlyRecommendation, dropperSectionOpen, userFlies]);

  const recHasDropper = Boolean(effectiveNextFlyRecommendation?.pattern2?.trim());

  const applyRecPrimary = useCallback(() => {
    if (!effectiveNextFlyRecommendation) return;
    const primary = primaryFromRecommendation(effectiveNextFlyRecommendation);
    if (singleEditSlot === 'secondary') return;
    onConfirm(primary, singleEditSlot === 'primary' ? (initialDropper ?? null) : null);
  }, [effectiveNextFlyRecommendation, onConfirm, singleEditSlot, initialDropper]);

  const applyRecDropper = useCallback(() => {
    if (!effectiveNextFlyRecommendation) return;
    const dropper = dropperFromRecommendation(effectiveNextFlyRecommendation);
    if (!dropper) return;
    if (singleEditSlot === 'primary') return;
    if (singleEditSlot === 'secondary' && initialPrimary?.pattern?.trim()) {
      onConfirm(initialPrimary, dropper);
      return;
    }
    onConfirm(dropper, null);
  }, [effectiveNextFlyRecommendation, onConfirm, singleEditSlot, initialPrimary]);

  const flySearchQuery = flySearch.trim().toLowerCase();

  const boxGridItems: FlyImageGridItem[] = useMemo(
    () =>
      userFlies
        .filter((f) => !flySearchQuery || f.name.toLowerCase().includes(flySearchQuery))
        .map((f) => ({
          key: f.id,
          name: f.name,
          photoUrl: isUserFlyPhotoUrl(f.photo_url) ? f.photo_url : null,
          size: f.size,
          color: f.color,
        })),
    [userFlies, flySearchQuery],
  );

  const catalogGridItems: FlyImageGridItem[] = useMemo(() => {
    return flyCatalog
      .filter((c) => !flySearchQuery || c.name.toLowerCase().includes(flySearchQuery))
      .map((c) => ({
        key: c.id,
        name: c.name,
        photoUrl: c.photo_url,
      }));
  }, [flyCatalog, flySearchQuery]);

  const selectedBoxKey = useMemo(() => {
    if (effectiveActiveSlot === 'primary') {
      return resolveUserBoxFlyIdForPicker(
        primaryUserBoxFlyId,
        primaryCatalogFlyId,
        pickerName,
        pickerSize,
        pickerColor,
        userFlies,
        flyCatalog,
      );
    }
    return resolveUserBoxFlyIdForPicker(
      dropperUserBoxFlyId,
      dropperCatalogFlyId,
      pickerName2,
      pickerSize2,
      pickerColor2,
      userFlies,
      flyCatalog,
    );
  }, [
    effectiveActiveSlot,
    primaryUserBoxFlyId,
    primaryCatalogFlyId,
    pickerName,
    pickerSize,
    pickerColor,
    dropperUserBoxFlyId,
    dropperCatalogFlyId,
    pickerName2,
    pickerSize2,
    pickerColor2,
    userFlies,
    flyCatalog,
  ]);

  const selectedCatalogKey = useMemo(() => {
    if (selectedBoxKey) return null;
    const catalogFlyId = effectiveActiveSlot === 'primary' ? primaryCatalogFlyId : dropperCatalogFlyId;
    if (catalogFlyId) return catalogFlyId;
    const pattern = effectiveActiveSlot === 'primary' ? pickerName : pickerName2;
    if (!pattern?.trim()) return null;
    return flyCatalog.find((c) => c.name === pattern.trim())?.id ?? null;
  }, [
    selectedBoxKey,
    effectiveActiveSlot,
    primaryCatalogFlyId,
    dropperCatalogFlyId,
    pickerName,
    pickerName2,
    flyCatalog,
  ]);

  const applyUserFlySelection = useCallback(
    (fly: Pick<Fly, 'id' | 'name' | 'size' | 'color'>, slot: 'primary' | 'dropper') => {
      if (slot === 'primary') {
        setPickerName(fly.name);
        setPickerSize(fly.size ?? null);
        setPickerColor(fly.color ?? null);
        setPrimaryUserBoxFlyId(fly.id);
        setPrimaryCatalogFlyId(null);
      } else {
        setPickerName2(fly.name);
        setPickerSize2(fly.size ?? null);
        setPickerColor2(fly.color ?? null);
        setDropperUserBoxFlyId(fly.id);
        setDropperCatalogFlyId(null);
      }
    },
    [],
  );

  const applyUserFly = useCallback(
    (item: FlyImageGridItem, slot: 'primary' | 'dropper') => {
      const fly = userFlies.find((f) => f.id === item.key);
      if (!fly) return;
      applyUserFlySelection(fly, slot);
    },
    [userFlies, applyUserFlySelection],
  );

  const applyCatalogFly = useCallback(
    (item: FlyImageGridItem, slot: 'primary' | 'dropper') => {
      const catalogFly = flyCatalog.find((c) => c.id === item.key);
      if (!catalogFly) return;

      const boxFly = userFlies.find((f) => f.fly_id === catalogFly.id);
      if (boxFly) {
        applyUserFly(
          { key: boxFly.id, name: boxFly.name, photoUrl: boxFly.photo_url, size: boxFly.size, color: boxFly.color },
          slot,
        );
        return;
      }

      if (userId) {
        setActiveSlot(slot);
        setInitialCatalogFlyForAdd(catalogFly);
        setAddSheetOpen(true);
        return;
      }

      if (slot === 'primary') {
        setPickerName(catalogFly.name);
        setPickerSize(null);
        setPickerColor(null);
        setPrimaryUserBoxFlyId(null);
        setPrimaryCatalogFlyId(catalogFly.id);
      } else {
        setPickerName2(catalogFly.name);
        setPickerSize2(null);
        setPickerColor2(null);
        setDropperUserBoxFlyId(null);
        setDropperCatalogFlyId(catalogFly.id);
      }
    },
    [flyCatalog, userFlies, userId, applyUserFly],
  );

  const handleConfirm = useCallback(() => {
    if (singleEditSlot === 'primary') {
      const primary = buildFlyChangeFromSelection(
        pickerName,
        pickerSize,
        pickerColor,
        primaryUserBoxFlyId,
        primaryCatalogFlyId,
        userFlies,
        flyCatalog,
      );
      if (!primary) return;
      onConfirm(primary, initialDropper ?? null);
      return;
    }
    if (singleEditSlot === 'secondary') {
      if (!initialPrimary?.pattern?.trim()) return;
      const dropper = buildFlyChangeFromSelection(
        pickerName2,
        pickerSize2,
        pickerColor2,
        dropperUserBoxFlyId,
        dropperCatalogFlyId,
        userFlies,
        flyCatalog,
      );
      if (!dropper) return;
      onConfirm(initialPrimary, dropper);
      return;
    }
    const primary = buildFlyChangeFromSelection(
      pickerName,
      pickerSize,
      pickerColor,
      primaryUserBoxFlyId,
      primaryCatalogFlyId,
      userFlies,
      flyCatalog,
    );
    if (!primary) return;
    const dropper =
      pickerName2 != null && String(pickerName2).trim()
        ? buildFlyChangeFromSelection(
            pickerName2,
            pickerSize2,
            pickerColor2,
            dropperUserBoxFlyId,
            dropperCatalogFlyId,
            userFlies,
            flyCatalog,
          )
        : null;
    onConfirm(primary, dropper);
  }, [
    pickerName,
    pickerSize,
    pickerColor,
    primaryUserBoxFlyId,
    primaryCatalogFlyId,
    pickerName2,
    pickerSize2,
    pickerColor2,
    dropperUserBoxFlyId,
    dropperCatalogFlyId,
    userFlies,
    flyCatalog,
    onConfirm,
    singleEditSlot,
    initialPrimary,
    initialDropper,
  ]);

  const canConfirm =
    singleEditSlot === 'primary'
      ? isFlySelectionValid({
          pattern: pickerName,
          size: pickerSize,
          color: pickerColor,
          userBoxFlyId: primaryUserBoxFlyId,
          catalogFlyId: primaryCatalogFlyId,
        })
      : singleEditSlot === 'secondary'
        ? isFlySelectionValid({
            pattern: pickerName2,
            size: pickerSize2,
            color: pickerColor2,
            userBoxFlyId: dropperUserBoxFlyId,
            catalogFlyId: dropperCatalogFlyId,
          })
        : isFlySelectionValid({
            pattern: pickerName,
            size: pickerSize,
            color: pickerColor,
            userBoxFlyId: primaryUserBoxFlyId,
            catalogFlyId: primaryCatalogFlyId,
          }) &&
          (!dropperSectionOpen ||
            isFlySelectionValid({
              pattern: pickerName2,
              size: pickerSize2,
              color: pickerColor2,
              userBoxFlyId: dropperUserBoxFlyId,
              catalogFlyId: dropperCatalogFlyId,
            }));

  const confirmButtonLabel = useMemo(() => {
    const slot = effectiveActiveSlot;
    const pattern = slot === 'dropper' ? pickerName2 : pickerName;
    const size = slot === 'dropper' ? pickerSize2 : pickerSize;
    const color = slot === 'dropper' ? pickerColor2 : pickerColor;
    const userBoxFlyId = slot === 'dropper' ? dropperUserBoxFlyId : primaryUserBoxFlyId;
    const catalogFlyId = slot === 'dropper' ? dropperCatalogFlyId : primaryCatalogFlyId;
    const initial = slot === 'dropper' ? initialDropper : initialPrimary;

    if (!isFlySelectionValid({ pattern, size, color, userBoxFlyId, catalogFlyId })) {
      return 'Select fly';
    }

    const current = buildFlyChangeFromSelection(
      pattern,
      size,
      color,
      userBoxFlyId,
      catalogFlyId,
      userFlies,
      flyCatalog,
    );

    if (current && isSameFlyChangeSelection(current, initial)) {
      return 'Keep fly';
    }

    return `Select ${displayFlyName(pattern!.trim())}`;
  }, [
    effectiveActiveSlot,
    pickerName,
    pickerSize,
    pickerColor,
    primaryUserBoxFlyId,
    primaryCatalogFlyId,
    pickerName2,
    pickerSize2,
    pickerColor2,
    dropperUserBoxFlyId,
    dropperCatalogFlyId,
    initialPrimary,
    initialDropper,
    userFlies,
    flyCatalog,
  ]);

  const primarySlotChipPreview = useMemo(
    () =>
      buildRigSlotChipPreview(
        initialPrimary,
        pickerName,
        pickerSize,
        pickerColor,
        primaryUserBoxFlyId,
        primaryCatalogFlyId,
        userFlies,
        flyCatalog,
      ),
    [
      initialPrimary,
      pickerName,
      pickerSize,
      pickerColor,
      primaryUserBoxFlyId,
      primaryCatalogFlyId,
      userFlies,
      flyCatalog,
    ],
  );
  const dropperSlotChipPreview = useMemo(
    () =>
      buildRigSlotChipPreview(
        initialDropper,
        pickerName2,
        pickerSize2,
        pickerColor2,
        dropperUserBoxFlyId,
        dropperCatalogFlyId,
        userFlies,
        flyCatalog,
      ),
    [
      initialDropper,
      pickerName2,
      pickerSize2,
      pickerColor2,
      dropperUserBoxFlyId,
      dropperCatalogFlyId,
      userFlies,
      flyCatalog,
    ],
  );

  const renderSlotChip = (
    slotTitle: 'Primary' | 'Secondary',
    preview: { oldLabel: string | null; newLabel: string | null; showArrow: boolean },
    active: boolean,
  ) => {
    const currentLabel = preview.oldLabel ?? preview.newLabel ?? '—';
    const line1Name =
      preview.showArrow && preview.oldLabel
        ? preview.oldLabel
        : preview.showArrow && !preview.oldLabel
          ? '—'
          : currentLabel;
    return (
      <View style={styles.slotChipBody}>
        <Text
          style={[styles.slotChipText, active && styles.slotChipTextActive]}
          numberOfLines={1}
        >
          {slotTitle}:{' '}
          {preview.showArrow && preview.oldLabel ? (
            <Text style={styles.slotChipOld}>{line1Name}</Text>
          ) : (
            line1Name
          )}
        </Text>
        {preview.showArrow && preview.newLabel ? (
          <Text
            style={[styles.slotChipNewLine, active && styles.slotChipNewActive]}
            numberOfLines={1}
          >
            → {preview.newLabel}
          </Text>
        ) : null}
      </View>
    );
  };

  const handleFlySaved = useCallback(
    (fly: Fly) => {
      const next = userFlies.some((f) => f.id === fly.id)
        ? userFlies.map((f) => (f.id === fly.id ? fly : f))
        : [...userFlies, fly];
      next.sort((a, b) => a.name.localeCompare(b.name));
      setUserFlies(next);
      onUserFliesUpdated?.(next);
      applyUserFlySelection(fly, effectiveActiveSlot);
    },
    [userFlies, onUserFliesUpdated, applyUserFlySelection, effectiveActiveSlot],
  );

  const handleCatalogAddSelect = useCallback(
    (catalogFly: FlyCatalog) => {
      const existing = userFlies.find((f) => f.fly_id === catalogFly.id);
      setAddFlyOpen(false);
      setOpenAsCustom(false);
      if (existing) {
        applyUserFly(
          {
            key: existing.id,
            name: existing.name,
            photoUrl: existing.photo_url,
            size: existing.size,
            color: existing.color,
          },
          effectiveActiveSlot,
        );
        return;
      }
      setInitialCatalogFlyForAdd(catalogFly);
      setAddSheetOpen(true);
    },
    [userFlies, applyUserFly, effectiveActiveSlot],
  );

  const handleOtherAddSelect = useCallback(() => {
    setAddFlyOpen(false);
    setInitialCatalogFlyForAdd(null);
    setOpenAsCustom(true);
    setAddSheetOpen(true);
  }, []);

  const handleAddSheetClose = useCallback(() => {
    setAddSheetOpen(false);
    setInitialCatalogFlyForAdd(null);
    setOpenAsCustom(false);
  }, []);

  const handleAddSheetSaved = useCallback(
    (fly: Fly) => {
      handleFlySaved(fly);
      setAddSheetOpen(false);
      setInitialCatalogFlyForAdd(null);
      setOpenAsCustom(false);
    },
    [handleFlySaved],
  );

  const windowH = Dimensions.get('window').height;
  const sheetMaxH = windowH * 0.92;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : 'fullScreen'}
      statusBarTranslucent={Platform.OS === 'android'}
      transparent={Platform.OS === 'android'}
    >
      <View style={styles.modalRoot} pointerEvents="box-none">
        <Pressable style={styles.modalDimTap} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={styles.modalSheetOverlay} pointerEvents="box-none">
          <View style={styles.modalSheetSafe}>
            <View style={[styles.flyPickerSheet, { height: sheetMaxH }]}>
              <View style={styles.flyPickerHeader}>
                <Text style={styles.flyPickerTitle}>{title}</Text>
                <Pressable onPress={onClose} hitSlop={12}>
                  <Text style={styles.flyPickerClose}>Cancel</Text>
                </Pressable>
              </View>

              {effectiveNextFlyRecommendation ? (
                <View style={styles.nextFlyBanner}>
                  <Text style={styles.nextFlyLabel}>
                    {recommendationLoading ? 'AI thinking…' : 'Try next'}
                  </Text>
                  <View style={styles.nextFlyBody}>
                    <View style={styles.nextFlyTilesCol}>
                      {singleEditSlot !== 'secondary' ? (
                      <FlyImageTile
                        name={effectiveNextFlyRecommendation.pattern}
                        photoUrl={resolveFlyPhotoUrl(
                          effectiveNextFlyRecommendation.pattern,
                          effectiveNextFlyRecommendation.size,
                          effectiveNextFlyRecommendation.color,
                          null,
                          effectiveNextFlyRecommendation.fly_id ?? null,
                          userFlies,
                          flyCatalog,
                        )}
                        size={effectiveNextFlyRecommendation.size}
                        color={effectiveNextFlyRecommendation.color}
                        variant="row"
                        onPress={applyRecPrimary}
                      />
                      ) : null}
                      {recHasDropper && singleEditSlot !== 'primary' ? (
                        <FlyImageTile
                          name={effectiveNextFlyRecommendation.pattern2!.trim()}
                          photoUrl={resolveFlyPhotoUrl(
                            effectiveNextFlyRecommendation.pattern2!.trim(),
                            effectiveNextFlyRecommendation.size2 ?? null,
                            effectiveNextFlyRecommendation.color2 ?? null,
                            null,
                            effectiveNextFlyRecommendation.fly_id2 ?? null,
                            userFlies,
                            flyCatalog,
                          )}
                          size={effectiveNextFlyRecommendation.size2 ?? null}
                          color={effectiveNextFlyRecommendation.color2 ?? null}
                          variant="row"
                          onPress={applyRecDropper}
                        />
                      ) : null}
                    </View>
                    <View style={styles.nextFlyTextCol}>
                      {effectiveNextFlyRecommendation.reason ? (
                        <Text style={styles.nextFlyReason} numberOfLines={5}>
                          {effectiveNextFlyRecommendation.reason}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              ) : null}

              <ScrollView style={styles.flyPickerScroll} contentContainerStyle={styles.flyPickerContent} keyboardShouldPersistTaps="handled">
                {dropperSectionOpen && !singleEditSlot ? (
                  <View style={styles.slotSwitcher}>
                    <Pressable
                      style={[styles.slotChip, activeSlot === 'primary' && styles.slotChipActive]}
                      onPress={() => setActiveSlot('primary')}
                    >
                      {renderSlotChip('Primary', primarySlotChipPreview, activeSlot === 'primary')}
                    </Pressable>
                    <Pressable
                      style={[styles.slotChip, activeSlot === 'dropper' && styles.slotChipActive]}
                      onPress={() => setActiveSlot('dropper')}
                    >
                      {renderSlotChip('Secondary', dropperSlotChipPreview, activeSlot === 'dropper')}
                    </Pressable>
                  </View>
                ) : null}

                <View style={styles.searchWrap}>
                  <Ionicons name="search" size={18} color={colors.textTertiary} />
                  <TextInput
                    style={styles.searchInput}
                    value={flySearch}
                    onChangeText={setFlySearch}
                    placeholder="Search flies…"
                    placeholderTextColor={colors.textTertiary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    clearButtonMode="while-editing"
                  />
                </View>

                <FlyImageGrid
                  title="My fly box"
                  items={boxGridItems}
                  selectedKey={selectedBoxKey}
                  onSelect={(item) => applyUserFly(item, effectiveActiveSlot)}
                  onAddNew={userId && !flySearchQuery ? () => setAddFlyOpen(true) : undefined}
                  addNewLabel="Add New"
                  emptyMessage={flySearchQuery ? 'No matches in your box' : 'No flies in your box yet'}
                />

                <FlyImageGrid
                  title="Catalog"
                  items={catalogGridItems}
                  selectedKey={selectedCatalogKey}
                  onSelect={(item) => applyCatalogFly(item, effectiveActiveSlot)}
                  emptyMessage={flySearchQuery ? 'No matches in catalog' : 'No flies in catalog'}
                />

                {!singleEditSlot ? (
                pickerName2 === null ? (
                  <Pressable style={styles.addDropperButton} onPress={() => setPickerName2('')}>
                    <Text style={styles.addDropperButtonText}>Add secondary (e.g. hopper-dropper)</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={styles.addDropperButton}
                    onPress={() => {
                      setPickerName2(null);
                      setPickerSize2(null);
                      setPickerColor2(null);
                      setDropperUserBoxFlyId(null);
                      setDropperCatalogFlyId(null);
                      setActiveSlot('primary');
                    }}
                  >
                    <Text style={styles.addDropperButtonText}>Remove secondary</Text>
                  </Pressable>
                )
                ) : null}
              </ScrollView>

              <View style={[styles.flyPickerFooter, { paddingBottom: Math.max(Spacing.md, insets.bottom) }]}>
                <Pressable
                  style={[styles.confirmFlyButton, !canConfirm && styles.confirmFlyButtonDisabled]}
                  onPress={handleConfirm}
                  disabled={!canConfirm}
                >
                  <Text style={styles.confirmFlyButtonText}>{confirmButtonLabel}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </View>

      {userId ? (
        <>
          <FlyCatalogAddModal
            visible={addFlyOpen}
            onClose={() => setAddFlyOpen(false)}
            catalog={flyCatalog}
            onSelectCatalogFly={handleCatalogAddSelect}
            onSelectOther={handleOtherAddSelect}
            title="Add fly to box"
          />
          <AddFlySheet
            visible={addSheetOpen}
            onClose={handleAddSheetClose}
            userId={userId}
            isConnected={isConnected}
            catalog={flyCatalog}
            initialCatalogFly={initialCatalogFlyForAdd}
            openAsCustom={openAsCustom}
            tripId={tripId}
            onSaved={handleAddSheetSaved}
            title="Add fly to box"
          />
        </>
      ) : null}
    </Modal>
  );
}

function createFlyPickerStyles(colors: ThemeColors, modalScrim: string) {
  return StyleSheet.create({
    modalRoot: { flex: 1, backgroundColor: modalScrim },
    modalDimTap: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
    modalSheetOverlay: { flex: 1, width: '100%', justifyContent: 'flex-end', backgroundColor: 'transparent' },
    modalSheetSafe: { width: '100%', backgroundColor: 'transparent' },
    flyPickerSheet: {
      width: '100%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      overflow: 'hidden',
      flexDirection: 'column',
      alignSelf: 'stretch',
    },
    flyPickerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    flyPickerTitle: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text },
    flyPickerClose: { fontSize: FontSize.md, color: colors.primary, fontWeight: '600' },
    nextFlyBanner: {
      backgroundColor: colors.accent,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    nextFlyLabel: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.textInverse,
      textTransform: 'uppercase',
    },
    nextFlyReason: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.85)', lineHeight: 16 },
    nextFlyBody: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginTop: Spacing.xs,
      alignItems: 'flex-start',
    },
    nextFlyTilesCol: {
      width: 132,
      gap: Spacing.xs,
      flexShrink: 0,
    },
    nextFlyTextCol: {
      flex: 1,
      minWidth: 0,
    },
    flyPickerScroll: { flexGrow: 1, flexShrink: 1, minHeight: 0 },
    flyPickerContent: { padding: Spacing.lg, paddingBottom: Spacing.lg },
    flyPickerFooter: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    slotSwitcher: {
      flexDirection: 'row',
      gap: Spacing.xs,
      marginBottom: Spacing.md,
    },
    slotChip: {
      flex: 1,
      borderRadius: BorderRadius.md,
      borderWidth: 1.5,
      borderColor: colors.border,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.sm,
      backgroundColor: colors.background,
    },
    slotChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + '12',
    },
    slotChipBody: {
      alignItems: 'center',
      gap: 2,
    },
    slotChipText: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 16,
    },
    slotChipTextActive: { color: colors.primary },
    slotChipOld: {
      color: colors.textTertiary,
      textDecorationLine: 'line-through',
    },
    slotChipNewLine: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      lineHeight: 16,
    },
    slotChipNewActive: {
      color: colors.primary,
    },
    flyFieldLabel: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: Spacing.sm,
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.sm,
      paddingHorizontal: Spacing.sm,
      marginBottom: Spacing.md,
      backgroundColor: colors.background,
      gap: Spacing.xs,
    },
    searchInput: { flex: 1, fontSize: FontSize.md, color: colors.text, paddingVertical: Spacing.sm },
    addDropperButton: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      marginBottom: Spacing.sm,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      borderStyle: 'dashed',
      alignSelf: 'flex-start',
    },
    addDropperButtonText: { fontSize: FontSize.sm, color: colors.primary },
    confirmFlyButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      alignItems: 'center',
    },
    confirmFlyButtonDisabled: { backgroundColor: colors.border },
    confirmFlyButtonText: { color: colors.textInverse, fontSize: FontSize.md, fontWeight: '600' },
  });
}
