import { useEffect, useMemo, useRef, useState } from 'react';
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
  /** First row: clear pattern (optional). Used by add/edit catch fly row. */
  showNoPatternRow?: boolean;
  /** Highlight the “—” row when no pattern is selected */
  noPatternRowActive?: boolean;
  onSelectNoPattern?: () => void;
  onSelectUserFly: (fly: Fly) => void;
  onSelectCatalogFly: (item: FlyCatalog) => void;
  /** User finished entering a custom pattern name in-sheet (may be empty). */
  onSelectOther: (customName: string) => void;
  /** Seed the “Other” field when reopening while in manual mode */
  initialOtherPatternName?: string | null;
  /**
   * `embedded` — no native `Modal`; use inside another modal with an absolute-fill host.
   * Avoids invisible touch layers when stacking modals (e.g. add-catch sheet on web).
   */
  presentation?: 'modal' | 'embedded';
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
    otherEntryWrap: {
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    otherEntryLabel: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: Spacing.xs,
    },
    otherEntryInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.sm,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Platform.OS === 'ios' ? Spacing.sm : Spacing.xs,
      fontSize: FontSize.md,
      color: colors.text,
      backgroundColor: colors.background,
    },
    otherEntryActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: Spacing.lg,
      marginTop: Spacing.md,
    },
    otherEntryActionText: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.primary,
    },
    otherEntryCancelText: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.textSecondary,
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
  showNoPatternRow = false,
  noPatternRowActive = false,
  onSelectNoPattern,
  onSelectUserFly,
  onSelectCatalogFly,
  onSelectOther,
  initialOtherPatternName = null,
  presentation = 'modal',
}: TripFlyPatternPickerModalProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [otherExpanded, setOtherExpanded] = useState(false);
  const [otherDraft, setOtherDraft] = useState('');
  const otherInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  // Reset/sync when the sheet opens only — avoids wiping draft on parent re-renders while visible.
  useEffect(() => {
    if (!visible) {
      setOtherExpanded(false);
      setOtherDraft('');
      return;
    }
    setOtherDraft(initialOtherPatternName ?? '');
    setOtherExpanded(Boolean(otherActive));
  }, [visible]);

  useEffect(() => {
    if (!visible || !otherExpanded) return;
    const id = requestAnimationFrame(() => otherInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [visible, otherExpanded]);

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
      out.push({ title: 'My Flies', data: userRows });
    }
    out.push({ title: 'All Flies', data: [...catalogRows, otherRow] });
    return out;
  }, [userFlies, catalog, q]);

  // Do not mount <Modal> when closed — some platforms keep an invisible layer that eats touches
  // on the modal behind this one (e.g. add-catch sheet).
  if (!visible) {
    return null;
  }

  const body = (
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
            ListHeaderComponent={
              showNoPatternRow ? (
                <Pressable
                  style={[styles.row, noPatternRowActive && styles.rowActive]}
                  onPress={() => {
                    onSelectNoPattern?.();
                    onRequestClose();
                  }}
                >
                  <Text style={[styles.rowPrimary, noPatternRowActive && styles.rowTextActive]}>—</Text>
                  <Text style={styles.rowSecondary}>No pattern (optional)</Text>
                </Pressable>
              ) : null
            }
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
                const otherHighlighted =
                  (otherActive && !noPatternRowActive) || otherExpanded;
                if (otherExpanded) {
                  return (
                    <View style={[styles.otherEntryWrap, otherHighlighted && styles.rowActive]}>
                      <Text style={styles.otherEntryLabel}>Custom pattern</Text>
                      <TextInput
                        ref={otherInputRef}
                        style={styles.otherEntryInput}
                        value={otherDraft}
                        onChangeText={setOtherDraft}
                        placeholder="Type pattern name"
                        placeholderTextColor={colors.textTertiary}
                        autoCorrect={false}
                        autoCapitalize="words"
                        returnKeyType="done"
                        onSubmitEditing={() => {
                          onSelectOther(otherDraft.trim());
                          onRequestClose();
                        }}
                        clearButtonMode="while-editing"
                      />
                      <View style={styles.otherEntryActions}>
                        <Pressable
                          onPress={() => {
                            setOtherExpanded(false);
                            setOtherDraft(initialOtherPatternName ?? '');
                          }}
                          accessibilityRole="button"
                          accessibilityLabel="Cancel custom pattern"
                        >
                          <Text style={styles.otherEntryCancelText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            onSelectOther(otherDraft.trim());
                            onRequestClose();
                          }}
                          accessibilityRole="button"
                          accessibilityLabel="Use custom pattern"
                        >
                          <Text style={styles.otherEntryActionText}>Done</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                }
                return (
                  <Pressable
                    style={[styles.row, otherHighlighted && styles.rowActive]}
                    onPress={() => {
                      setOtherExpanded(true);
                      setOtherDraft((d) => d || (initialOtherPatternName ?? ''));
                    }}
                  >
                    <Text
                      style={[styles.rowPrimary, otherHighlighted && styles.rowTextActive]}
                    >
                      Other (type name)
                    </Text>
                    <Text style={styles.rowSecondary}>Not listed — tap to type here</Text>
                  </Pressable>
                );
              }
              if (item.kind === 'user') {
                const { fly } = item;
                const active = !noPatternRowActive && fly.id === selectedUserBoxFlyId;
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
                !noPatternRowActive &&
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
  );

  if (presentation === 'embedded') {
    return <View style={{ flex: 1 }}>{body}</View>;
  }

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onRequestClose}
      presentationStyle={Platform.OS === 'ios' ? 'overFullScreen' : undefined}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      {body}
    </Modal>
  );
}
