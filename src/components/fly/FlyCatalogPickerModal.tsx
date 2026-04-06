import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  FlatList,
  Platform,
  KeyboardAvoidingView,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { FlyCatalog } from '@/src/types';

export type FlyCatalogPickerModalProps = {
  visible: boolean;
  onRequestClose: () => void;
  /** Catalog rows (sorted display order is up to the caller). */
  catalog: FlyCatalog[];
  /** True when the user chose the custom / “other” row. */
  otherSelected: boolean;
  selectedCatalogFlyId: string | null;
  onSelectCatalogFly: (fly: FlyCatalog) => void;
  onSelectOther: () => void;
  title?: string;
  otherOptionLabel?: string;
  searchPlaceholder?: string;
  /** When false, hides the “other” row (catalog-only picker). */
  showOtherOption?: boolean;
};

function createStyles(colors: ThemeColors) {
  const windowH = Dimensions.get('window').height;
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      height: Math.min(Math.round(windowH * 0.88), 680),
      width: '100%',
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
    },
    handle: {
      width: 40,
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: Spacing.md,
    },
    title: {
      fontSize: FontSize.xl,
      fontWeight: '700',
      color: colors.text,
      marginBottom: Spacing.md,
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
    },
    searchIcon: {
      marginRight: Spacing.xs,
    },
    searchInput: {
      flex: 1,
      paddingVertical: Platform.OS === 'ios' ? Spacing.sm : Spacing.xs,
      fontSize: FontSize.md,
      color: colors.text,
    },
    list: {
      flex: 1,
    },
    row: {
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowActive: {
      backgroundColor: colors.borderLight,
    },
    rowText: {
      fontSize: FontSize.md,
      color: colors.text,
    },
    rowTextActive: {
      fontWeight: '600',
      color: colors.primary,
    },
    empty: {
      paddingVertical: Spacing.xl,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
    },
  });
}

/**
 * Full-height bottom sheet to pick a fly from the catalog, with search.
 * Reusable anywhere you need catalog + optional “custom pattern” row.
 */
export function FlyCatalogPickerModal({
  visible,
  onRequestClose,
  catalog,
  otherSelected,
  selectedCatalogFlyId,
  onSelectCatalogFly,
  onSelectOther,
  title = 'Select fly',
  otherOptionLabel = 'Other (new pattern)',
  searchPlaceholder = 'Search patterns…',
  showOtherOption = true,
}: FlyCatalogPickerModalProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? catalog.filter((c) => c.name.toLowerCase().includes(q)) : catalog),
    [catalog, q],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onRequestClose}
      presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : undefined}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.overlay}>
          <Pressable
            style={styles.backdrop}
            onPress={onRequestClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={20} color={colors.textTertiary} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>
          <FlatList
            style={styles.list}
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              showOtherOption ? (
                <Pressable
                  style={[styles.row, otherSelected && !selectedCatalogFlyId && styles.rowActive]}
                  onPress={() => {
                    onSelectOther();
                    onRequestClose();
                  }}
                >
                  <Text
                    style={[
                      styles.rowText,
                      otherSelected && !selectedCatalogFlyId && styles.rowTextActive,
                    ]}
                  >
                    {otherOptionLabel}
                  </Text>
                </Pressable>
              ) : null
            }
            ListEmptyComponent={
              q.length > 0 && filtered.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No patterns match your search.</Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                style={[styles.row, selectedCatalogFlyId === item.id && styles.rowActive]}
                onPress={() => {
                  onSelectCatalogFly(item);
                  onRequestClose();
                }}
              >
                <Text
                  style={[styles.rowText, selectedCatalogFlyId === item.id && styles.rowTextActive]}
                >
                  {item.name}
                </Text>
              </Pressable>
            )}
          />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
