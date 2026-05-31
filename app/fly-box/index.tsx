import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/src/stores/authStore';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { FLY_PRESENTATION_LABELS, COMMON_FLIES_BY_NAME } from '@/src/constants/fishingTypes';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import type { Fly, FlyCatalog } from '@/src/types';
import { resolveFlyImageSourceForFly } from '@/src/utils/resolveFlyPhotoUrl';
import {
  fetchFlies,
  fetchFliesOrCache,
  getFlyCatalogOrBundled,
  deleteFly,
  removeFlyFromUserCache,
} from '@/src/services/flyService';
import {
  enqueuePendingFlyDelete,
  removePendingFlyCreate,
} from '@/src/services/pendingFlyOpsStorage';
import { AddFlySheet } from '@/src/components/fly/AddFlySheet';
import { FlyCatalogAddModal } from '@/src/components/fly/FlyCatalogAddModal';
import { displayFlyName } from '@/src/utils/flyValidation';

function FlyRow({
  fly,
  catalog,
  onEdit,
  onDelete,
  readOnly,
  colors,
  styles,
}: {
  fly: Fly;
  catalog: FlyCatalog[];
  onEdit: () => void;
  onDelete: () => void;
  readOnly?: boolean;
  colors: ThemeColors;
  styles: any;
}) {
  const [useBundledFallback, setUseBundledFallback] = useState(false);

  useEffect(() => {
    setUseBundledFallback(false);
  }, [fly.id, fly.photo_url, fly.name]);

  const common = COMMON_FLIES_BY_NAME[fly.name];
  const displaySize = fly.size ?? common?.size ?? null;
  const displayColor = fly.color ?? common?.color ?? null;
  const detail =
    [displaySize != null ? `#${displaySize}` : null, displayColor].filter(Boolean).join(' · ') || null;
  const presentationLabel =
    fly.presentation != null
      ? FLY_PRESENTATION_LABELS[fly.presentation]
      : common?.presentation != null
        ? FLY_PRESENTATION_LABELS[common.presentation]
        : null;
  const qty = fly.quantity ?? 1;
  const imageSource = useBundledFallback
    ? getBundledFlyImageSource(fly.name) ?? resolveFlyImageSourceForFly(fly, catalog)
    : resolveFlyImageSourceForFly(fly, catalog);
  return (
    <View style={styles.flyRow}>
      {imageSource ? (
        <Image
          source={imageSource}
          style={styles.flyRowImage}
          resizeMode="contain"
          onError={() => setUseBundledFallback(true)}
        />
      ) : (
        <View style={styles.flyRowImagePlaceholder}>
          <Ionicons name="fish-outline" size={24} color={colors.textTertiary} />
        </View>
      )}
      <View style={styles.flyRowMain}>
        <View style={styles.flyRowNameRow}>
          <Text style={styles.flyRowName} numberOfLines={1}>{displayFlyName(fly.name)}</Text>
          {qty > 1 ? <Text style={styles.flyRowQuantity}>×{qty}</Text> : null}
        </View>
        <View style={styles.flyRowMeta}>
          {presentationLabel ? (
            <Text style={styles.flyRowPresentation}>{presentationLabel}</Text>
          ) : null}
          {detail ? <Text style={styles.flyRowDetail}>{detail}</Text> : null}
          {(fly.use_count ?? 0) > 0 && (
            <Text style={styles.flyRowUses}>{fly.use_count} uses</Text>
          )}
        </View>
      </View>
      {!readOnly ? (
        <View style={styles.flyRowActions}>
          <Pressable style={styles.iconButton} onPress={onEdit} hitSlop={8}>
            <Ionicons name="pencil" size={20} color={colors.primary} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={onDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={20} color={colors.error} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function parseForUserIdParam(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim();
}

export default function FlyBoxScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createFlyBoxStyles(colors), [colors]);
  const router = useRouter();
  const { forUserId: forUserIdParam, ownerName: ownerNameParam } = useLocalSearchParams<{
    forUserId?: string | string[];
    ownerName?: string | string[];
  }>();
  const forUserId = useMemo(() => parseForUserIdParam(forUserIdParam), [forUserIdParam]);
  const ownerNameFromParam = useMemo(() => {
    const v = Array.isArray(ownerNameParam) ? ownerNameParam[0] : ownerNameParam;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }, [ownerNameParam]);
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const { isConnected } = useNetworkStatus();
  const { user } = useAuthStore();
  const resolvedOwnerId = forUserId ?? user?.id ?? null;
  const readOnly = Boolean(user && forUserId && forUserId !== user.id);
  const [flies, setFlies] = useState<Fly[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogAddOpen, setCatalogAddOpen] = useState(false);
  const [initialCatalogFly, setInitialCatalogFly] = useState<FlyCatalog | null>(null);
  const [openAsCustom, setOpenAsCustom] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingFly, setEditingFly] = useState<Fly | null>(null);
  const [catalog, setCatalog] = useState<FlyCatalog[]>([]);

  const loadFlies = useCallback(async () => {
    if (!resolvedOwnerId) return;
    setLoading(true);
    try {
      const list = readOnly
        ? await fetchFlies(resolvedOwnerId)
        : user
          ? await fetchFliesOrCache(resolvedOwnerId)
          : [];
      list.sort((a, b) => a.name.localeCompare(b.name));
      setFlies(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [resolvedOwnerId, readOnly, user]);

  useFocusEffect(
    useCallback(() => {
      loadFlies();
      void getFlyCatalogOrBundled().then(setCatalog);
    }, [loadFlies])
  );

  const openAdd = () => {
    setCatalogAddOpen(true);
  };

  const openEdit = (fly: Fly) => {
    setEditingFly(fly);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingFly(null);
    setInitialCatalogFly(null);
    setOpenAsCustom(false);
  };

  const handleCatalogSelect = (catalogFly: FlyCatalog) => {
    setCatalogAddOpen(false);
    setOpenAsCustom(false);
    const existing = flies.find((f) => f.fly_id === catalogFly.id);
    if (existing) {
      setEditingFly(existing);
      setInitialCatalogFly(null);
    } else {
      setEditingFly(null);
      setInitialCatalogFly(catalogFly);
    }
    setSheetOpen(true);
  };

  const handleOtherSelect = () => {
    setCatalogAddOpen(false);
    setEditingFly(null);
    setInitialCatalogFly(null);
    setOpenAsCustom(true);
    setSheetOpen(true);
  };

  const handleFlySaved = useCallback(
    (fly: Fly) => {
      setFlies((prev) => {
        const exists = prev.some((f) => f.id === fly.id);
        const next = exists ? prev.map((f) => (f.id === fly.id ? fly : f)) : [...prev, fly];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      void loadFlies();
    },
    [loadFlies],
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile');
    }
  }, [router]);

  const handleDelete = (fly: Fly) => {
    Alert.alert(
      'Remove fly',
      `Remove "${fly.name}" from your fly box?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              if (!user) return;
              if (!isConnected) {
                if (fly.id.startsWith('pg_')) {
                  await removePendingFlyCreate(fly.id);
                } else {
                  await enqueuePendingFlyDelete(user.id, fly.id);
                }
                await removeFlyFromUserCache(user.id, fly.id);
                await loadFlies();
                return;
              }
              await deleteFly(fly.id);
              await loadFlies();
            } catch (e) {
              console.error(e);
              Alert.alert('Error', 'Could not remove fly.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + Spacing.lg }]}>
      <View style={[styles.screenHeader, { paddingTop: effectiveTop + Spacing.sm }]}>
        <Pressable
          style={styles.screenHeaderBack}
          onPress={goBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textInverse} />
          <Text style={styles.screenHeaderBackLabel}>Back</Text>
        </Pressable>
        <View style={styles.screenHeaderCenter}>
          <Text style={styles.screenHeaderTitle} numberOfLines={1}>
            {readOnly && ownerNameFromParam ? `${ownerNameFromParam}'s fly box` : 'Fly Box'}
          </Text>
        </View>
        <View style={styles.screenHeaderSide} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.subtitle}>
          {readOnly
            ? 'Patterns they have saved to their fly box.'
            : 'Keep inventory of your flies for quick switching on trips. The AI will use your fly box in recommendations.'}
        </Text>

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        ) : flies.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="fish-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No flies yet</Text>
            <Text style={styles.emptySubtext}>
              {readOnly ? 'No flies in this box yet.' : 'Tap Add Fly to build your tackle box'}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {flies.map((fly) => (
              <FlyRow
                key={fly.id}
                fly={fly}
                catalog={catalog}
                onEdit={() => openEdit(fly)}
                onDelete={() => handleDelete(fly)}
                readOnly={readOnly}
                colors={colors}
                styles={styles}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {!readOnly ? (
        <Pressable style={[styles.fab, { bottom: insets.bottom + Spacing.lg }]} onPress={openAdd}>
          <Ionicons name="add" size={28} color={colors.textInverse} />
          <Text style={styles.fabLabel}>Add Fly</Text>
        </Pressable>
      ) : null}

      {!readOnly && user ? (
        <>
          <FlyCatalogAddModal
            visible={catalogAddOpen}
            onClose={() => setCatalogAddOpen(false)}
            catalog={catalog}
            onSelectCatalogFly={handleCatalogSelect}
            onSelectOther={handleOtherSelect}
          />
          <AddFlySheet
            visible={sheetOpen}
            onClose={closeSheet}
            userId={user.id}
            isConnected={isConnected}
            catalog={catalog}
            editingFly={editingFly}
            initialCatalogFly={initialCatalogFly}
            openAsCustom={openAsCustom}
            onSaved={handleFlySaved}
          />
        </>
      ) : null}
    </View>
  );
}

function createFlyBoxStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    backgroundColor: colors.primary,
  },
  screenHeaderBack: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 88,
  },
  screenHeaderBackLabel: {
    fontSize: FontSize.md,
    fontWeight: '500',
    color: colors.textInverse,
    marginLeft: -4,
  },
  screenHeaderCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenHeaderTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: colors.textInverse,
  },
  screenHeaderSide: {
    minWidth: 88,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: 100,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    marginBottom: Spacing.lg,
    lineHeight: 20,
  },
  loader: { marginVertical: Spacing.xxl },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  emptyText: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: colors.text,
    marginTop: Spacing.md,
  },
  emptySubtext: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
    marginTop: Spacing.xs,
  },
  list: {
    gap: Spacing.xs,
  },
  flyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  flyRowImage: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.sm,
    marginRight: Spacing.md,
    backgroundColor: colors.surface,
  },
  flyRowImagePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.sm,
    marginRight: Spacing.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flyRowMain: { flex: 1, minWidth: 0 },
  flyRowNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  flyRowName: {
    flex: 1,
    minWidth: 0,
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  flyRowQuantity: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  flyRowMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: 2,
  },
  flyRowType: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
  },
  flyRowPresentation: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  flyRowDetail: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
  },
  flyRowUses: {
    fontSize: FontSize.xs,
    color: colors.primary,
  },
  flyRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  iconButton: {
    padding: Spacing.xs,
  },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6 },
      android: { elevation: 4 },
    }),
  },
  fabLabel: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.textInverse,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    zIndex: 1,
    ...Platform.select({
      android: { elevation: 8 },
    }),
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: Spacing.lg,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: colors.text,
    marginBottom: Spacing.md,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.md,
  },
  dropdownTriggerText: {
    fontSize: FontSize.md,
    color: colors.text,
    flex: 1,
  },
  dropdownPlaceholder: {
    color: colors.textTertiary,
  },
  dropdownBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  dropdownSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    maxHeight: '60%',
  },
  dropdownScroll: {
    maxHeight: 320,
  },
  dropdownOption: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dropdownOptionActive: {
    backgroundColor: colors.borderLight,
  },
  dropdownOptionText: {
    fontSize: FontSize.md,
    color: colors.text,
  },
  dropdownOptionTextActive: {
    fontWeight: '600',
    color: colors.primary,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  quantityBtn: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityBtnDisabled: {
    opacity: 0.5,
  },
  quantityValue: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: colors.text,
    minWidth: 36,
    textAlign: 'center',
  },
  typeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  typeChip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipActive: {
    backgroundColor: `${colors.primary}18`,
    borderColor: colors.primary,
  },
  typeChipText: {
    fontSize: FontSize.sm,
    color: colors.text,
  },
  typeChipTextActive: {
    fontWeight: '600',
    color: colors.primary,
  },
  sizeScroll: {
    marginBottom: Spacing.md,
    marginHorizontal: -Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  sizeChip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: Spacing.sm,
  },
  sizeChipActive: {
    backgroundColor: `${colors.primary}18`,
    borderColor: colors.primary,
  },
  sizeChipText: {
    fontSize: FontSize.sm,
    color: colors.text,
  },
  sizeChipTextActive: {
    fontWeight: '600',
    color: colors.primary,
  },
  presentationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  presChip: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presChipActive: {
    backgroundColor: `${colors.primary}18`,
    borderColor: colors.primary,
  },
  presChipText: {
    fontSize: FontSize.sm,
    color: colors.text,
  },
  presChipTextActive: {
    fontWeight: '600',
    color: colors.primary,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  photoPreviewWrap: {
    position: 'relative',
  },
  photoPreview: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.background,
  },
  photoRemove: {
    position: 'absolute',
    top: -8,
    right: -8,
  },
  addPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addPhotoButtonText: {
    fontSize: FontSize.sm,
    color: colors.primary,
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.background,
  },
  cancelButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  saveButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.primary,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.textInverse,
  },
  });
}
