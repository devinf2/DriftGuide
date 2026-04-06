import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  SectionList,
  Platform,
  KeyboardAvoidingView,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { Fly, FlyCatalog } from '@/src/types';

export type TripFlyPatternPickerRow =
  | { key: string; kind: 'user'; fly: Fly }
  | { key: string; kind: 'catalog'; item: FlyCatalog }
  | { key: string; kind: 'other' };

export type TripFlyPatternPickerModalProps = {
  visible: boolean;
  onRequestClose: () => void;
  userFlies: Fly[];
  catalog: FlyCatalog[];
  title?: string;
  searchPlaceholder?: string;
  /** Highlight fly box row */
  selectedUserBoxFlyId: string | null;
  /** Highlight catalog row */
  selectedCatalogFlyId: string | null;
  /** Highlight “Other” when pattern is typed manually */
  otherActive?: boolean;
  onSelectUserFly: (fly: Fly) => void;
  onSelectCatalogFly: (item: FlyCatalog) => void;
  onSelectOther: () => void;
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
    sectionHeader: {
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.xs,
      backgroundColor: colors.surface,
    },
    sectionTitle: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
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
    rowPrimary: {
      fontSize: FontSize.md,
      color: colors.text,
      fontWeight: '500',
    },
    rowSecondary: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      marginTop: 2,
    },
    rowTextActive: {
      fontWeight: '600',
      color: colors.primary,
    },
    empty: {
      paddingVertical: Spacing.lg,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
    },
  });
}

function matchesQuery(fly: Fly, q: string): boolean {
  if (!q) return true;
  const parts = [
    fly.name,
    fly.size != null ? `#${fly.size}` : '',
    fly.color ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return parts.includes(q);
}

function matchesCatalog(item: FlyCatalog, q: string): boolean {
  if (!q) return true;
  return item.name.toLowerCase().includes(q);
}

/**
 * Trip / journal pattern picker: “My flies” (fly box) + “All flies” (catalog), search, and Other.
 */
export function TripFlyPatternPickerModal({
  visible,
  onRequestClose,
  userFlies,
  catalog,
  title = 'Select pattern',
  searchPlaceholder = 'Search patterns…',
  selectedUserBoxFlyId,
  selectedCatalogFlyId,
  otherActive = false,
  onSelectUserFly,
  onSelectCatalogFly,
  onSelectOther,
}: TripFlyPatternPickerModalProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const q = query.trim().toLowerCase();

  const sections = useMemo(() => {
    const userSorted = [...userFlies].sort((a, b) => {
      const n = a.name.localeCompare(b.name);
      if (n !== 0) return n;
      const sa = a.size ?? 0;
      const sb = b.size ?? 0;
      if (sa !== sb) return sa - sb;
      return (a.color ?? '').localeCompare(b.color ?? '');
    });
    const userRows: TripFlyPatternPickerRow[] = userSorted
      .filter((fly) => matchesQuery(fly, q))
      .map((fly) => ({ key: `u:${fly.id}`, kind: 'user' as const, fly }));

    const catSorted = [...catalog].sort((a, b) => a.name.localeCompare(b.name));
    const catalogRows: TripFlyPatternPickerRow[] = catSorted
      .filter((item) => matchesCatalog(item, q))
      .map((item) => ({ key: `c:${item.id}`, kind: 'catalog' as const, item }));

    const otherRow: TripFlyPatternPickerRow = { key: 'other', kind: 'other' };

    const out: { title: string; data: TripFlyPatternPickerRow[] }[] = [];
    if (userRows.length > 0) {
      out.push({ title: 'My flies', data: userRows });
    }
    out.push({ title: 'All flies', data: [...catalogRows, otherRow] });
    return out;
  }, [userFlies, catalog, q]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onRequestClose}
      presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : undefined}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
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
            <SectionList
              sections={sections}
              keyExtractor={(item) => item.key}
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No patterns match your search.</Text>
                </View>
              }
              renderSectionHeader={({ section: { title: st } }) => (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{st}</Text>
                </View>
              )}
              renderItem={({ item }) => {
                  if (item.kind === 'other') {
                    return (
                      <Pressable
                        style={[styles.row, otherActive && styles.rowActive]}
                        onPress={() => {
                          onSelectOther();
                          onRequestClose();
                        }}
                      >
                        <Text style={[styles.rowPrimary, otherActive && styles.rowTextActive]}>
                          Other (type name)
                        </Text>
                        <Text style={styles.rowSecondary}>Not listed — enter a custom pattern</Text>
                      </Pressable>
                    );
                  }
                  if (item.kind === 'user') {
                    const { fly } = item;
                    const active = fly.id === selectedUserBoxFlyId;
                    const sub =
                      [fly.size != null ? `#${fly.size}` : null, fly.color].filter(Boolean).join(' · ') ||
                      'No size/color';
                    return (
                      <Pressable
                        style={[styles.row, active && styles.rowActive]}
                        onPress={() => {
                          onSelectUserFly(fly);
                          onRequestClose();
                        }}
                      >
                        <Text style={[styles.rowPrimary, active && styles.rowTextActive]}>{fly.name}</Text>
                        <Text style={styles.rowSecondary}>{sub}</Text>
                      </Pressable>
                    );
                  }
                  const { item: cat } = item;
                  const active =
                    cat.id === selectedCatalogFlyId &&
                    selectedUserBoxFlyId == null &&
                    !otherActive;
                  return (
                    <Pressable
                      style={[styles.row, active && styles.rowActive]}
                      onPress={() => {
                        onSelectCatalogFly(cat);
                        onRequestClose();
                      }}
                    >
                      <Text style={[styles.rowPrimary, active && styles.rowTextActive]}>{cat.name}</Text>
                    </Pressable>
                  );
                }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
