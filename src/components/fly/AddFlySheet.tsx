import { useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  TextInput,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import {
  FLY_SIZE_ROWS,
  FLY_COLOR_ROWS,
  FLY_COLORS,
  FLY_PRESENTATION_LABELS,
} from '@/src/constants/fishingTypes';
import type { Fly, FlyCatalog, FlyPresentation } from '@/src/types';
import { createFly, updateFly, appendOptimisticFlyToCache } from '@/src/services/flyService';
import { enqueuePendingFlyCreate } from '@/src/services/pendingFlyOpsStorage';
import { uploadFlyPhoto } from '@/src/services/photoService';
import { FlyCatalogAddModal } from '@/src/components/fly/FlyCatalogAddModal';
import { FlyImagePreviewModal } from '@/src/components/fly/FlyImagePreviewModal';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import { isFlyInputValid, resolveFlyNameForSave } from '@/src/utils/flyValidation';

const FLY_PRESENTATIONS: FlyPresentation[] = ['dry', 'emerger', 'wet', 'nymph', 'streamer'];

const COLOR_CHIP_ROWS: readonly (readonly string[])[] =
  FLY_COLOR_ROWS.length > 0
    ? FLY_COLOR_ROWS
    : [FLY_COLORS.slice(0, 7), FLY_COLORS.slice(7)];

type ChipOption = {
  key: string;
  label: string;
  selected: boolean;
  onPress: () => void;
};

function ChipGridRows({
  rows,
  styles,
  compact,
}: {
  rows: ChipOption[][];
  styles: ReturnType<typeof createStyles>;
  compact?: boolean;
}) {
  return (
    <View style={styles.chipGrid}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.chipRowFixed}>
          {row.map((opt) => (
            <Pressable
              key={opt.key}
              style={[
                styles.chip,
                styles.chipFlex,
                compact && styles.chipCompact,
                opt.selected && styles.chipActive,
              ]}
              onPress={opt.onPress}
            >
              <Text
                style={[
                  styles.chipText,
                  compact && styles.chipTextCompact,
                  opt.selected && styles.chipTextActive,
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

export type AddFlySheetProps = {
  visible: boolean;
  onClose: () => void;
  userId: string;
  isConnected: boolean;
  catalog: FlyCatalog[];
  editingFly?: Fly | null;
  /** Pre-select a catalog pattern when opening the add flow (step 2 after catalog pick). */
  initialCatalogFly?: FlyCatalog | null;
  /** Open directly in custom / other mode (name + optional photo, not from catalog). */
  openAsCustom?: boolean;
  /** When adding during an active trip, tie pending sync to this trip. */
  tripId?: string | null;
  onSaved: (fly: Fly) => void;
  /** iOS: fires after the sheet finishes dismissing — lets callers sequence a following modal transition. */
  onDismiss?: () => void;
  title?: string;
};

export function AddFlySheet({
  visible,
  onClose,
  userId,
  isConnected,
  catalog,
  editingFly = null,
  initialCatalogFly = null,
  openAsCustom = false,
  tripId = null,
  onSaved,
  onDismiss,
  title,
}: AddFlySheetProps) {
  const { colors } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const photoTileSize = Math.floor((windowWidth - Spacing.lg * 2 - Spacing.md) / 2);
  const styles = useMemo(() => createStyles(colors, photoTileSize), [colors, photoTileSize]);
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [size, setSize] = useState<number | ''>('');
  const [color, setColor] = useState('');
  const [presentation, setPresentation] = useState<FlyPresentation | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [clearPhoto, setClearPhoto] = useState(false);
  const [selectedCatalogFly, setSelectedCatalogFly] = useState<FlyCatalog | null>(null);
  const [catalogPickerVisible, setCatalogPickerVisible] = useState(false);
  const [customPatternMode, setCustomPatternMode] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [previewImage, setPreviewImage] = useState<{
    source: ImageSourcePropType;
    title: string;
  } | null>(null);

  useEffect(() => {
    if (!visible) return;
    if (editingFly) {
      const catalogFly = editingFly.fly_id ? catalog.find((c) => c.id === editingFly.fly_id) ?? null : null;
      setSelectedCatalogFly(catalogFly);
      setName(editingFly.name);
      setSize(editingFly.size ?? '');
      setColor(editingFly.color ?? '');
      setPresentation(editingFly.presentation ?? null);
      setPhotoUri(null);
      setClearPhoto(false);
      setQuantity(Math.max(1, editingFly.quantity ?? 1));
      setCustomPatternMode(!catalogFly);
    } else if (initialCatalogFly) {
      setSelectedCatalogFly(initialCatalogFly);
      setName(initialCatalogFly.name);
      setSize('');
      setColor('');
      setPresentation((initialCatalogFly.presentation as FlyPresentation) ?? null);
      setPhotoUri(null);
      setClearPhoto(false);
      setQuantity(1);
      setCustomPatternMode(false);
    } else if (openAsCustom) {
      setSelectedCatalogFly(null);
      setName('');
      setSize('');
      setColor('');
      setPresentation(null);
      setPhotoUri(null);
      setClearPhoto(false);
      setQuantity(1);
      setCustomPatternMode(true);
    } else {
      setSelectedCatalogFly(null);
      setName('');
      setSize('');
      setColor('');
      setPresentation(null);
      setPhotoUri(null);
      setClearPhoto(false);
      setQuantity(1);
      setCustomPatternMode(false);
    }
    setCatalogPickerVisible(false);
    setPreviewImage(null);
  }, [visible, editingFly, initialCatalogFly, openAsCustom, catalog]);

  const userPhotoUri =
    photoUri ?? (editingFly?.photo_url && !clearPhoto ? editingFly.photo_url : null);

  const flyImageSource = useMemo((): ImageSourcePropType | null => {
    const catalogFly =
      selectedCatalogFly ??
      (editingFly?.fly_id ? catalog.find((c) => c.id === editingFly.fly_id) ?? null : null);
    const catalogUrl = catalogFly?.photo_url?.trim();
    if (catalogUrl) return { uri: catalogUrl };
    const patternName = catalogFly?.name ?? selectedCatalogFly?.name ?? name.trim() ?? editingFly?.name;
    return getBundledFlyImageSource(patternName);
  }, [selectedCatalogFly, editingFly, catalog, name]);

  const canSave = useMemo(
    () =>
      isFlyInputValid({
        name: selectedCatalogFly?.name ?? name,
        photo: userPhotoUri,
        size: size === '' ? null : Number(size),
        color: color.trim() || null,
        catalogFlyId: selectedCatalogFly?.id ?? editingFly?.fly_id,
      }) && !saving,
    [selectedCatalogFly, editingFly, name, userPhotoUri, size, color, saving],
  );

  const pickImageFrom = async (source: 'camera' | 'library') => {
    const editOpts = { allowsEditing: true, aspect: [1, 1] as [number, number], quality: 0.8 };
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow camera access to take a fly photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync(editOpts);
      if (!result.canceled && result.assets[0]) {
        setPhotoUri(result.assets[0].uri);
        setClearPhoto(false);
      }
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to photos to add a fly image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], ...editOpts });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
      setClearPhoto(false);
    }
  };

  const promptAddPhoto = () => {
    Keyboard.dismiss();
    Alert.alert('Fly photo', undefined, [
      { text: 'Take Photo', onPress: () => void pickImageFrom('camera') },
      { text: 'Choose from Library', onPress: () => void pickImageFrom('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const openFlyImagePreview = () => {
    if (!flyImageSource) return;
    setPreviewImage({ source: flyImageSource, title: patternLabel });
  };

  const handleUserPhotoPress = () => {
    if (userPhotoUri) {
      setPreviewImage({ source: { uri: userPhotoUri }, title: 'Your photo' });
      return;
    }
    promptAddPhoto();
  };

  const handleUserPhotoLongPress = () => {
    if (userPhotoUri) promptAddPhoto();
  };

  const clearUserPhoto = () => {
    if (photoUri) setPhotoUri(null);
    else setClearPhoto(true);
  };

  const handleSave = async () => {
    if (!canSave) return;
    Keyboard.dismiss();
    const nameVal = resolveFlyNameForSave(name, Boolean(userPhotoUri), selectedCatalogFly?.name);
    const sizeNum = size === '' ? null : Number(size);
    setSaving(true);
    try {
      if (!isConnected && editingFly) {
        Alert.alert('Offline', 'Reconnect to edit flies already saved to your account.');
        return;
      }

      let photoUrl: string | null = null;
      let localPhotoUri = photoUri;
      if (photoUri && isConnected) {
        photoUrl = await uploadFlyPhoto(userId, photoUri);
        localPhotoUri = null;
      }

      if (editingFly) {
        const updated = await updateFly(editingFly.id, {
          name: nameVal,
          size: sizeNum,
          color: color.trim() || null,
          presentation,
          quantity,
          ...(clearPhoto ? { photo_url: null } : photoUrl !== null ? { photo_url: photoUrl } : {}),
        });
        onSaved(updated);
        onClose();
        return;
      }

      if (!isConnected) {
        const clientId = `pg_${uuidv4()}`;
        let durablePhotoUri: string | null = null;
        if (photoUri?.trim()) {
          const { copyUriToPendingPhotoSandbox } = await import('@/src/services/persistentPhotoUri');
          durablePhotoUri = await copyUriToPendingPhotoSandbox(photoUri.trim());
        }
        const input = {
          ...(selectedCatalogFly
            ? { fly_id: selectedCatalogFly.id }
            : {
                name: nameVal,
                type: 'fly' as const,
                presentation: presentation ?? undefined,
              }),
          size: sizeNum,
          color: color.trim() || null,
          quantity,
          ...(photoUrl != null && { photo_url: photoUrl }),
          ...(durablePhotoUri && !photoUrl && { local_photo_uri: durablePhotoUri }),
        };
        await enqueuePendingFlyCreate(userId, clientId, input, tripId ?? undefined);
        const optimistic: Fly = {
          id: clientId,
          user_id: userId,
          name: selectedCatalogFly?.name ?? nameVal,
          type: 'fly',
          size: sizeNum,
          color: color.trim() || null,
          photo_url: durablePhotoUri ?? photoUrl,
          presentation: presentation ?? selectedCatalogFly?.presentation ?? null,
          quantity,
          fly_id: selectedCatalogFly?.id,
        };
        await appendOptimisticFlyToCache(userId, optimistic);
        onSaved(optimistic);
        onClose();
        return;
      }

      const created = await createFly(userId, {
        ...(selectedCatalogFly
          ? { fly_id: selectedCatalogFly.id }
          : { name: nameVal, type: 'fly', presentation: presentation ?? undefined }),
        size: sizeNum,
        color: color.trim() || null,
        quantity,
        ...(photoUrl != null && { photo_url: photoUrl }),
      });
      onSaved(created);
      onClose();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Could not save fly. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const patternLabel = selectedCatalogFly?.name ?? name.trim() ?? editingFly?.name ?? 'Select pattern';

  const handleCatalogReselect = (fly: FlyCatalog) => {
    setSelectedCatalogFly(fly);
    setName(fly.name);
    setPresentation((fly.presentation as FlyPresentation) ?? null);
    setCustomPatternMode(false);
    setCatalogPickerVisible(false);
  };

  const handleSelectOtherPattern = () => {
    setSelectedCatalogFly(null);
    setName('');
    setCustomPatternMode(true);
    setCatalogPickerVisible(false);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onDismiss}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, Spacing.md) }]}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{title ?? (editingFly ? 'Edit fly' : 'Add fly')}</Text>
          <Pressable onPress={handleSave} disabled={!canSave} hitSlop={12}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.headerAction, !canSave && styles.headerActionDisabled]}>
                {editingFly ? 'Save' : 'Add'}
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {customPatternMode ? (
            <>
              <Text style={[styles.label, styles.labelFirst]}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Fly name"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="words"
                autoCorrect={false}
              />
              <Pressable
                style={styles.catalogLinkRow}
                onPress={() => setCatalogPickerVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Choose from catalog"
              >
                <Text style={styles.patternChangeHint}>Choose from catalog</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.label, styles.labelFirst]}>Pattern</Text>
              <Pressable
                style={styles.patternTrigger}
                onPress={() => setCatalogPickerVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Change pattern selection"
              >
                <Text style={[styles.patternTriggerText, !selectedCatalogFly && !name.trim() && !editingFly?.name && styles.placeholder]}>
                  {patternLabel}
                </Text>
                <Text style={styles.patternChangeHint}>Change</Text>
              </Pressable>
            </>
          )}

          <View style={styles.photoRow}>
            {!customPatternMode ? (
              <View style={styles.photoColumn}>
                <Text style={styles.photoLabel}>Fly image</Text>
                <Pressable
                  style={({ pressed }) => [styles.photoTile, pressed && flyImageSource && styles.photoTilePressed]}
                  onPress={openFlyImagePreview}
                  disabled={!flyImageSource}
                  accessibilityRole="button"
                  accessibilityLabel={
                    flyImageSource ? `View ${patternLabel} catalog image full screen` : 'No catalog image'
                  }
                >
                  {flyImageSource ? (
                    <Image
                      source={flyImageSource}
                      style={styles.sideImage}
                      resizeMode="contain"
                      pointerEvents="none"
                    />
                  ) : (
                    <View style={styles.sidePlaceholder} pointerEvents="none">
                      <Ionicons name="fish-outline" size={28} color={colors.textTertiary} />
                    </View>
                  )}
                </Pressable>
              </View>
            ) : null}
            <View style={styles.photoColumn}>
              <Text style={styles.photoLabel}>{customPatternMode ? 'Photo' : 'Your photo'}</Text>
              <Pressable
                style={({ pressed }) => [styles.photoTile, pressed && styles.photoTilePressed]}
                onPress={handleUserPhotoPress}
                onLongPress={userPhotoUri ? handleUserPhotoLongPress : undefined}
                accessibilityRole="button"
                accessibilityLabel={
                  userPhotoUri ? 'View your fly photo full screen' : 'Add your fly photo'
                }
              >
                {userPhotoUri ? (
                  <Image
                    source={{ uri: userPhotoUri }}
                    style={styles.sideImage}
                    resizeMode="contain"
                    pointerEvents="none"
                  />
                ) : (
                  <View style={styles.sidePlaceholder} pointerEvents="none">
                    <Ionicons name="camera-outline" size={28} color={colors.primary} />
                    <Text style={styles.heroHint}>Add photo</Text>
                  </View>
                )}
                {userPhotoUri ? (
                  <Pressable
                    style={styles.heroClear}
                    onPress={clearUserPhoto}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Remove your photo"
                  >
                    <Ionicons name="close-circle" size={24} color={colors.error} />
                  </Pressable>
                ) : null}
              </Pressable>
            </View>
          </View>

          <Text style={styles.label}>Size (optional)</Text>
          <ChipGridRows
            styles={styles}
            rows={FLY_SIZE_ROWS.map((row) =>
              row.map((s) => ({
                key: String(s),
                label: `#${s}`,
                selected: size === s,
                onPress: () => {
                  Keyboard.dismiss();
                  setSize(size === s ? '' : s);
                },
              })),
            )}
          />

          <Text style={styles.label}>Color (optional)</Text>
          <ChipGridRows
            styles={styles}
            compact
            rows={COLOR_CHIP_ROWS.map((row) =>
              row.map((c) => ({
                key: c,
                label: c,
                selected: color.trim() === c,
                onPress: () => {
                  Keyboard.dismiss();
                  setColor(color.trim() === c ? '' : c);
                },
              })),
            )}
          />

          <Text style={styles.label}>Presentation (optional)</Text>
          <ChipGridRows
            styles={styles}
            rows={[
              FLY_PRESENTATIONS.slice(0, 3).map((p) => ({
                key: p,
                label: FLY_PRESENTATION_LABELS[p],
                selected: presentation === p,
                onPress: () => {
                  Keyboard.dismiss();
                  setPresentation(presentation === p ? null : p);
                },
              })),
              FLY_PRESENTATIONS.slice(3).map((p) => ({
                key: p,
                label: FLY_PRESENTATION_LABELS[p],
                selected: presentation === p,
                onPress: () => {
                  Keyboard.dismiss();
                  setPresentation(presentation === p ? null : p);
                },
              })),
            ]}
          />

          {/* Quantity hidden for now — defaults to 1 on save
          <Text style={styles.label}>Quantity</Text>
          <View style={styles.quantityRow}>
            <Pressable style={styles.qtyButton} onPress={() => setQuantity((q) => Math.max(1, q - 1))}>
              <Ionicons name="remove" size={20} color={colors.text} />
            </Pressable>
            <Text style={styles.qtyValue}>{quantity}</Text>
            <Pressable style={styles.qtyButton} onPress={() => setQuantity((q) => q + 1)}>
              <Ionicons name="add" size={20} color={colors.text} />
            </Pressable>
          </View>
          */}
        </ScrollView>

        <FlyCatalogAddModal
          visible={catalogPickerVisible}
          onClose={() => setCatalogPickerVisible(false)}
          catalog={catalog}
          onSelectCatalogFly={handleCatalogReselect}
          onSelectOther={handleSelectOtherPattern}
          title="Change pattern"
        />

        <FlyImagePreviewModal
          visible={previewImage != null}
          onClose={() => setPreviewImage(null)}
          imageSource={previewImage?.source ?? null}
          title={previewImage?.title ?? null}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors, photoTileSize: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    headerAction: { fontSize: FontSize.md, fontWeight: '600', color: colors.primary, minWidth: 56 },
    headerActionDisabled: { color: colors.textTertiary },
    content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
    photoRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: Spacing.md,
      marginBottom: Spacing.lg,
    },
    photoColumn: {
      width: photoTileSize,
      flexShrink: 0,
    },
    photoLabel: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: Spacing.xs,
      textAlign: 'center',
    },
    photoTile: {
      position: 'relative',
      width: photoTileSize,
      height: photoTileSize,
    },
    photoTilePressed: {
      opacity: 0.85,
    },
    sideImage: {
      width: photoTileSize,
      height: photoTileSize,
      borderRadius: BorderRadius.lg,
      backgroundColor: colors.surface,
    },
    sidePlaceholder: {
      width: photoTileSize,
      height: photoTileSize,
      borderRadius: BorderRadius.lg,
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.border,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
    },
    heroHint: { fontSize: FontSize.xs, color: colors.textSecondary, fontWeight: '600' },
    heroClear: { position: 'absolute', top: -6, right: -6 },
    label: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: Spacing.sm,
      marginTop: Spacing.sm,
    },
    labelFirst: { marginTop: 0 },
    patternTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm + 2,
      backgroundColor: colors.surface,
      marginBottom: Spacing.sm,
    },
    patternTriggerText: { flex: 1, fontSize: FontSize.md, color: colors.text },
    patternChangeHint: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary },
    catalogLinkRow: { alignSelf: 'flex-start', marginBottom: Spacing.md },
    placeholder: { color: colors.textTertiary },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
      backgroundColor: colors.surface,
      marginBottom: Spacing.sm,
    },
    chipGrid: { gap: Spacing.xs, marginBottom: Spacing.sm },
    chipRowFixed: { flexDirection: 'row', gap: Spacing.xs },
    chipFlex: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
      paddingHorizontal: Spacing.xs,
    },
    chipCompact: {
      paddingHorizontal: 2,
      paddingVertical: Spacing.xs,
    },
    chip: {
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: BorderRadius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs + 2,
      backgroundColor: colors.surface,
    },
    chipActive: { borderColor: colors.primary, backgroundColor: colors.primary + '15' },
    chipText: { fontSize: FontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    chipTextCompact: { fontSize: FontSize.xs },
    chipTextActive: { color: colors.primary, fontWeight: '600' },
    quantityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
    qtyButton: {
      width: 36,
      height: 36,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    qtyValue: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, minWidth: 32, textAlign: 'center' },
  });
}
