import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { FlyImageGrid, type FlyImageGridItem } from '@/src/components/fly/FlyImageGrid';
import { groupItemsByPresentation } from '@/src/utils/groupFliesByPresentation';

export type FlyPresentationSectionedGridProps = {
  /** Optional top-level label (e.g. "Catalog", "My fly box"). */
  sectionTitle?: string;
  items: FlyImageGridItem[];
  selectedKey?: string | null;
  onSelect: (item: FlyImageGridItem) => void;
  onAddNew?: () => void;
  addNewLabel?: string;
  emptyMessage?: string;
  columns?: number;
};

export function FlyPresentationSectionedGrid({
  sectionTitle,
  items,
  selectedKey,
  onSelect,
  onAddNew,
  addNewLabel = 'Add New',
  emptyMessage,
  columns,
}: FlyPresentationSectionedGridProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const presentationSections = useMemo(
    () =>
      groupItemsByPresentation(
        items,
        (item) => item.presentation ?? null,
        (a, b) => a.name.localeCompare(b.name),
      ),
    [items],
  );

  if (presentationSections.length === 0) {
    return (
      <View style={styles.block}>
        {sectionTitle || onAddNew ? (
          <View style={styles.sectionHeader}>
            {sectionTitle ? <Text style={styles.groupTitle}>{sectionTitle}</Text> : <View style={styles.titleSpacer} />}
            {onAddNew ? (
              <Pressable
                style={styles.headerAddBtn}
                onPress={onAddNew}
                accessibilityRole="button"
                accessibilityLabel={addNewLabel}
              >
                <Ionicons name="add" size={18} color={colors.primary} />
                <Text style={styles.headerAddLabel}>{addNewLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {emptyMessage ? <Text style={styles.empty}>{emptyMessage}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.block}>
      {presentationSections.map((section, index) => (
        <View key={section.key} style={styles.presentationSection}>
          {index === 0 && (sectionTitle || onAddNew) ? (
            <View style={styles.sectionHeader}>
              {sectionTitle ? (
                <Text style={styles.groupTitle}>{sectionTitle}</Text>
              ) : (
                <View style={styles.titleSpacer} />
              )}
              {onAddNew ? (
                <Pressable
                  style={styles.headerAddBtn}
                  onPress={onAddNew}
                  accessibilityRole="button"
                  accessibilityLabel={addNewLabel}
                >
                  <Ionicons name="add" size={18} color={colors.primary} />
                  <Text style={styles.headerAddLabel}>{addNewLabel}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <Text style={styles.presentationLabel}>{section.label}</Text>
          <FlyImageGrid
            items={section.items}
            selectedKey={selectedKey}
            onSelect={onSelect}
            columns={columns}
          />
        </View>
      ))}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    block: {
      marginBottom: Spacing.md,
    },
    presentationSection: {
      marginBottom: Spacing.sm,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.sm,
      gap: Spacing.sm,
    },
    groupTitle: {
      flex: 1,
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    titleSpacer: {
      flex: 1,
    },
    headerAddBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      flexShrink: 0,
    },
    headerAddLabel: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.primary,
    },
    presentationLabel: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.text,
      marginBottom: Spacing.xs,
    },
    empty: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      paddingVertical: Spacing.sm,
    },
  });
}
