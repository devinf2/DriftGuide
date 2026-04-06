import { useState, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  TouchableOpacity,
  Platform,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/src/stores/authStore';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import {
  FLY_TYPE_LABELS,
  FLY_SIZES as FLY_SIZES_LIST,
  FLY_COLORS,
  FLY_PRESENTATION_LABELS,
} from '@/src/constants/fishingTypes';
import type { Fly, FlyType, FlyPresentation } from '@/src/types';
import {
  fetchFliesOrCache,
  fetchFlyCatalog,
  loadFlyCatalogFromCache,
  createFly,
  updateFly,
  deleteFly,
  appendOptimisticFlyToCache,
  removeFlyFromUserCache,
} from '@/src/services/flyService';
import {
  enqueuePendingFlyCreate,
  enqueuePendingFlyDelete,
  removePendingFlyCreate,
} from '@/src/services/pendingFlyOpsStorage';
import { uploadFlyPhoto } from '@/src/services/photoService';
import type { FlyCatalog } from '@/src/types';

const FLY_PRESENTATIONS: FlyPresentation[] = ['dry', 'emerger', 'wet', 'nymph', 'streamer'];

function FlyRow({
  fly,
  onEdit,
  onDelete,
  colors,
  styles,
}: {
  fly: Fly;
  onEdit: () => void;
  onDelete: () => void;
  colors: ThemeColors;
  styles: any;
}) {
  const detail = [fly.size ? `#${fly.size}` : null, fly.color].filter(Boolean).join(' · ') || null;
  const presentationLabel =
    fly.presentation != null ? FLY_PRESENTATION_LABELS[fly.presentation] : null;
  const qty = fly.quantity ?? 1;
  return (
    <View style={styles.flyRow}>
      {fly.photo_url ? (
        <Image source={{ uri: fly.photo_url }} style={styles.flyRowImage} />
      ) : (
        <View style={styles.flyRowImagePlaceholder}>
          <Ionicons name="fish-outline" size={24} color={colors.textTertiary} />
        </View>
      )}
      <View style={styles.flyRowMain}>
        <View style={styles.flyRowNameRow}>
          <Text style={styles.flyRowName} numberOfLines={1}>{fly.name}</Text>
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
      <View style={styles.flyRowActions}>
        <Pressable style={styles.iconButton} onPress={onEdit} hitSlop={8}>
          <Ionicons name="pencil" size={20} color={colors.primary} />
        </Pressable>
        <Pressable style={styles.iconButton} onPress={onDelete} hitSlop={8}>
          <Ionicons name="trash-outline" size={20} color={colors.error} />
        </Pressable>
      </View>
    </View>
  );
}

export default function FlyBoxScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createFlyBoxStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const { isConnected } = useNetworkStatus();
  const { user } = useAuthStore();
  const [flies, setFlies] = useState<Fly[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingFly, setEditingFly] = useState<Fly | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [size, setSize] = useState<number | ''>('');
  const [color, setColor] = useState('');
  const [presentation, setPresentation] = useState<FlyPresentation | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [clearPhoto, setClearPhoto] = useState(false);
  const [catalog, setCatalog] = useState<FlyCatalog[]>([]);
  const [selectedCatalogFly, setSelectedCatalogFly] = useState<FlyCatalog | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState<null | 'fly' | 'size' | 'color'>(null);
  const [quantity, setQuantity] = useState(1);

  const loadFlies = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const list = await fetchFliesOrCache(user.id);
      list.sort((a, b) => a.name.localeCompare(b.name));
      setFlies(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadFlies();
      fetchFlyCatalog()
        .then(setCatalog)
        .catch(async () => {
          setCatalog(await loadFlyCatalogFromCache());
        });
    }, [loadFlies])
  );

  const openAdd = () => {
    setEditingFly(null);
    setSelectedCatalogFly(null);
    setName('');
    setSize('');
    setColor('');
    setPresentation(null);
    setPhotoUri(null);
    setClearPhoto(false);
    setDropdownOpen(null);
    setQuantity(1);
    setModalOpen(true);
  };

  const openEdit = (fly: Fly) => {
    setEditingFly(fly);
    const catalogFly = fly.fly_id ? catalog.find((c) => c.id === fly.fly_id) ?? null : null;
    setSelectedCatalogFly(catalogFly ?? null);
    setName(fly.name);
    setSize(fly.size ?? '');
    setColor(fly.color ?? '');
    setPresentation(fly.presentation ?? null);
    setPhotoUri(null);
    setClearPhoto(false);
    setDropdownOpen(null);
    setQuantity(Math.max(1, fly.quantity ?? 1));
    setModalOpen(true);
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to photos to add a fly image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingFly(null);
    setSaving(false);
  };

  const trimmedName = name.trim();
  const isOtherPattern = !selectedCatalogFly;
  const canSave =
    (selectedCatalogFly || (trimmedName && (editingFly || presentation != null))) &&
    size !== '' &&
    color.trim() !== '' &&
    !saving;

  const handleSave = async () => {
    if (!user) return;
    const nameVal = name.trim();
    const hasPattern = selectedCatalogFly || (nameVal && (editingFly || presentation != null));
    if (!hasPattern || size === '' || !color.trim()) return;
    const sizeNum = Number(size);
    setSaving(true);
    try {
      if (!isConnected && editingFly) {
        Alert.alert('Offline', 'Reconnect to edit flies already saved to your account.');
        return;
      }
      if (!isConnected && photoUri) {
        Alert.alert('Offline', 'Add photos after you reconnect.');
        return;
      }
      let photoUrl: string | null = null;
      if (photoUri) {
        photoUrl = await uploadFlyPhoto(user.id, photoUri);
      }
      if (editingFly) {
        await updateFly(editingFly.id, {
          name: nameVal,
          size: sizeNum,
          color: color.trim() || null,
          presentation,
          quantity,
          ...(clearPhoto ? { photo_url: null } : photoUrl !== null ? { photo_url: photoUrl } : {}),
        });
      } else if (!isConnected) {
        const clientId = `pg_${uuidv4()}`;
        const input = {
          ...(selectedCatalogFly
            ? { fly_id: selectedCatalogFly.id, ...(photoUrl != null && { photo_url: photoUrl }) }
            : {
                name: nameVal,
                type: 'fly' as const,
                presentation: presentation ?? undefined,
                photo_url: photoUrl,
              }),
          size: sizeNum,
          color: color.trim() || null,
          quantity,
        };
        await enqueuePendingFlyCreate(user.id, clientId, input);
        const optimistic: Fly = {
          id: clientId,
          user_id: user.id,
          name: selectedCatalogFly?.name ?? nameVal,
          type: 'fly',
          size: sizeNum,
          color: color.trim() || null,
          photo_url: null,
          presentation: presentation ?? selectedCatalogFly?.presentation ?? null,
          quantity,
          fly_id: selectedCatalogFly?.id,
        };
        await appendOptimisticFlyToCache(user.id, optimistic);
        setFlies((prev) => [...prev, optimistic].sort((a, b) => a.name.localeCompare(b.name)));
        closeModal();
        return;
      } else {
        await createFly(user.id, {
          ...(selectedCatalogFly
            ? { fly_id: selectedCatalogFly.id, ...(photoUrl != null && { photo_url: photoUrl }) }
            : { name: nameVal, type: 'fly', presentation: presentation ?? undefined, photo_url: photoUrl }),
          size: sizeNum,
          color: color.trim() || null,
          quantity,
        });
      }
      await loadFlies();
      closeModal();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Could not save fly. Try again.');
    } finally {
      setSaving(false);
    }
  };

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
            Fly Box
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
          Keep inventory of your flies for quick switching on trips. The AI will use your fly box in recommendations.
        </Text>

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        ) : flies.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="fish-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No flies yet</Text>
            <Text style={styles.emptySubtext}>Tap Add Fly to build your tackle box</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {flies.map((fly) => (
              <FlyRow
                key={fly.id}
                fly={fly}
                onEdit={() => openEdit(fly)}
                onDelete={() => handleDelete(fly)}
                colors={colors}
                styles={styles}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable style={[styles.fab, { bottom: insets.bottom + Spacing.lg }]} onPress={openAdd}>
        <Ionicons name="add" size={28} color={colors.textInverse} />
        <Text style={styles.fabLabel}>Add Fly</Text>
      </Pressable>

      <Modal
        visible={modalOpen}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={closeModal}
        >
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {editingFly ? 'Edit fly' : 'Add fly'}
            </Text>

            <Text style={styles.label}>Fly</Text>
            <Pressable style={styles.dropdownTrigger} onPress={() => setDropdownOpen('fly')}>
              <Text style={[styles.dropdownTriggerText, !selectedCatalogFly && !trimmedName && styles.dropdownPlaceholder]} numberOfLines={1}>
                {selectedCatalogFly ? selectedCatalogFly.name : trimmedName || 'Select fly'}
              </Text>
              <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
            </Pressable>

            {isOtherPattern && (
              <>
                <Text style={styles.label}>Pattern name</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Pheasant Tail Nymph"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="words"
                />
                <Text style={styles.label}>Presentation (how it fishes)</Text>
                <View style={styles.presentationRow}>
                  {FLY_PRESENTATIONS.map((p) => (
                    <Pressable
                      key={p}
                      style={[styles.presChip, presentation === p && styles.presChipActive]}
                      onPress={() => setPresentation(p)}
                    >
                      <Text style={[styles.presChipText, presentation === p && styles.presChipTextActive]}>
                        {FLY_PRESENTATION_LABELS[p]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.label}>Size (hook)</Text>
            <Pressable style={styles.dropdownTrigger} onPress={() => setDropdownOpen('size')}>
              <Text style={[styles.dropdownTriggerText, size === '' && styles.dropdownPlaceholder]} numberOfLines={1}>
                {size === '' ? 'Select size' : `#${size}`}
              </Text>
              <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
            </Pressable>

            <Text style={styles.label}>Color</Text>
            <Pressable style={styles.dropdownTrigger} onPress={() => setDropdownOpen('color')}>
              <Text style={[styles.dropdownTriggerText, !color.trim() && styles.dropdownPlaceholder]} numberOfLines={1}>
                {color.trim() || 'Select color'}
              </Text>
              <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
            </Pressable>

            <Text style={styles.label}>Quantity</Text>
            <View style={styles.quantityRow}>
              <Pressable
                style={[styles.quantityBtn, quantity <= 1 && styles.quantityBtnDisabled]}
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
              >
                <Ionicons name="remove" size={20} color={quantity <= 1 ? colors.textTertiary : colors.primary} />
              </Pressable>
              <Text style={styles.quantityValue}>×{quantity}</Text>
              <Pressable
                style={styles.quantityBtn}
                onPress={() => setQuantity((q) => q + 1)}
              >
                <Ionicons name="add" size={20} color={colors.primary} />
              </Pressable>
            </View>

            {dropdownOpen !== null && (
              <Modal visible transparent animationType="fade">
                <View style={styles.dropdownBackdrop}>
                  <Pressable style={StyleSheet.absoluteFill} onPress={() => setDropdownOpen(null)} />
                  <View style={styles.dropdownSheet} onStartShouldSetResponder={() => true}>
                    <ScrollView style={styles.dropdownScroll} keyboardShouldPersistTaps="handled">
                      {dropdownOpen === 'fly' && (
                        <>
                          <Pressable
                            style={[styles.dropdownOption, !selectedCatalogFly && styles.dropdownOptionActive]}
                            onPress={() => {
                              setSelectedCatalogFly(null);
                              setName('');
                              setPresentation(null);
                              setDropdownOpen(null);
                            }}
                          >
                            <Text style={[styles.dropdownOptionText, !selectedCatalogFly && styles.dropdownOptionTextActive]}>Other (new pattern)</Text>
                          </Pressable>
                          {catalog.map((c) => (
                            <Pressable
                              key={c.id}
                              style={[styles.dropdownOption, selectedCatalogFly?.id === c.id && styles.dropdownOptionActive]}
                              onPress={() => {
                                setSelectedCatalogFly(c);
                                setName(c.name);
                                setPresentation((c.presentation as FlyPresentation) ?? null);
                                setDropdownOpen(null);
                              }}
                            >
                              <Text style={[styles.dropdownOptionText, selectedCatalogFly?.id === c.id && styles.dropdownOptionTextActive]}>{c.name}</Text>
                            </Pressable>
                          ))}
                        </>
                      )}
                      {dropdownOpen === 'size' &&
                        FLY_SIZES_LIST.map((s) => (
                          <Pressable
                            key={s}
                            style={[styles.dropdownOption, size === s && styles.dropdownOptionActive]}
                            onPress={() => {
                              setSize(s);
                              setDropdownOpen(null);
                            }}
                          >
                            <Text style={[styles.dropdownOptionText, size === s && styles.dropdownOptionTextActive]}>#{s}</Text>
                          </Pressable>
                        ))}
                      {dropdownOpen === 'color' &&
                        FLY_COLORS.map((c) => (
                          <Pressable
                            key={c}
                            style={[styles.dropdownOption, color.trim() === c && styles.dropdownOptionActive]}
                            onPress={() => {
                              setColor(c);
                              setDropdownOpen(null);
                            }}
                          >
                            <Text style={[styles.dropdownOptionText, color.trim() === c && styles.dropdownOptionTextActive]}>{c}</Text>
                          </Pressable>
                        ))}
                    </ScrollView>
                  </View>
                </View>
              </Modal>
            )}

            <Text style={styles.label}>Photo (optional)</Text>
            <View style={styles.photoRow}>
              {(photoUri || (editingFly?.photo_url && !clearPhoto) || (!editingFly && selectedCatalogFly?.photo_url)) ? (
                <View style={styles.photoPreviewWrap}>
                  <Image
                    source={{
                      uri: photoUri ?? (editingFly?.photo_url && !clearPhoto ? editingFly.photo_url : null) ?? selectedCatalogFly?.photo_url ?? '',
                    }}
                    style={styles.photoPreview}
                  />
                  {(photoUri || (editingFly?.photo_url && !clearPhoto)) ? (
                    <Pressable
                      style={styles.photoRemove}
                      onPress={() => (photoUri ? setPhotoUri(null) : setClearPhoto(true))}
                    >
                      <Ionicons name="close-circle" size={24} color={colors.error} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <Pressable style={styles.addPhotoButton} onPress={pickImage}>
                <Ionicons name="camera-outline" size={22} color={colors.primary} />
                <Text style={styles.addPhotoButtonText}>
                  {photoUri || (editingFly?.photo_url && !clearPhoto) || selectedCatalogFly?.photo_url ? 'Change photo' : 'Add photo'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.modalActions}>
              <Pressable style={styles.cancelButton} onPress={closeModal}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
                onPress={handleSave}
                disabled={!canSave}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.saveButtonText}>{editingFly ? 'Save' : 'Add'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
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
    backgroundColor: colors.background,
  },
  flyRowImagePlaceholder: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.sm,
    marginRight: Spacing.md,
    backgroundColor: colors.background,
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
