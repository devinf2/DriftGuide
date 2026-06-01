import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { FlyCatalog } from '@/src/types';
import { FlyPresentationSectionedGrid } from '@/src/components/fly/FlyPresentationSectionedGrid';
import type { FlyImageGridItem } from '@/src/components/fly/FlyImageGrid';
import { resolveCatalogFlyPresentation } from '@/src/utils/groupFliesByPresentation';

export type FlyCatalogAddModalProps = {
  visible: boolean;
  onClose: () => void;
  catalog: FlyCatalog[];
  onSelectCatalogFly: (fly: FlyCatalog) => void;
  /** Top-right + opens a custom fly (name, photo, etc.) instead of catalog pick. */
  onSelectOther?: () => void;
  title?: string;
};

export function FlyCatalogAddModal({
  visible,
  onClose,
  catalog,
  onSelectCatalogFly,
  onSelectOther,
  title = 'Add fly',
}: FlyCatalogAddModalProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (visible) setSearch('');
  }, [visible]);

  const gridItems: FlyImageGridItem[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .map((c) => ({
        key: c.id,
        name: c.name,
        photoUrl: c.photo_url,
        presentation: resolveCatalogFlyPresentation(c),
      }));
  }, [catalog, search]);

  const handleSelect = (item: FlyImageGridItem) => {
    const catalogFly = catalog.find((c) => c.id === item.key);
    if (!catalogFly) return;
    onSelectCatalogFly(catalogFly);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, Spacing.md) }]}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{title}</Text>
          {onSelectOther ? (
            <Pressable
              style={styles.headerSide}
              onPress={() => {
                onClose();
                onSelectOther();
              }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Add custom fly"
            >
              <Ionicons name="add" size={28} color={colors.primary} />
            </Pressable>
          ) : (
            <View style={styles.headerSide} />
          )}
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search flies…"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <FlyPresentationSectionedGrid
            items={gridItems}
            onSelect={handleSelect}
            emptyMessage={search.trim() ? 'No matches' : 'No flies in catalog'}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
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
    headerSide: { minWidth: 56, alignItems: 'flex-end', justifyContent: 'center' },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: Spacing.lg,
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.sm,
      backgroundColor: colors.surface,
    },
    searchInput: {
      flex: 1,
      paddingVertical: Platform.OS === 'ios' ? Spacing.sm : Spacing.xs,
      paddingHorizontal: Spacing.xs,
      fontSize: FontSize.md,
      color: colors.text,
    },
    content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
  });
}
