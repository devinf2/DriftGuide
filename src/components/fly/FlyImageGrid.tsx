import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { FlyImageTile } from '@/src/components/fly/FlyImageTile';

export type FlyImageGridItem = {
  key: string;
  name: string;
  photoUrl?: string | null;
  size?: number | null;
  color?: string | null;
};

export type FlyImageGridProps = {
  title?: string;
  items: FlyImageGridItem[];
  selectedKey?: string | null;
  onSelect: (item: FlyImageGridItem) => void;
  onAddNew?: () => void;
  addNewLabel?: string;
  emptyMessage?: string;
  horizontal?: boolean;
  tileVariant?: 'grid' | 'large' | 'compact';
  /** Items per row in wrapped grid (default 5) */
  columns?: number;
};

export function FlyImageGrid({
  title,
  items,
  selectedKey,
  onSelect,
  onAddNew,
  addNewLabel = 'Add New',
  emptyMessage,
  horizontal = false,
  tileVariant = 'grid',
  columns = 5,
}: FlyImageGridProps) {
  const { colors } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const styles = createStyles(colors);

  const columnGap = Spacing.sm;
  const gridPadding = Spacing.lg * 2;
  const tileWidth = horizontal
    ? tileVariant === 'compact'
      ? 72
      : 96
    : Math.floor((windowWidth - gridPadding - columnGap * (columns - 1)) / columns);

  const content = (
    <View style={[styles.grid, horizontal && styles.gridHorizontal]}>
      {items.map((item) => (
        <FlyImageTile
          key={item.key}
          name={item.name}
          photoUrl={item.photoUrl}
          size={item.size}
          color={item.color}
          selected={selectedKey === item.key}
          onPress={() => onSelect(item)}
          variant={tileVariant}
          tileWidth={horizontal ? undefined : tileWidth}
        />
      ))}
      {items.length === 0 && !onAddNew && emptyMessage ? (
        <Text style={styles.empty}>{emptyMessage}</Text>
      ) : null}
    </View>
  );

  const showSectionHeader = Boolean(title || onAddNew);

  return (
    <View style={styles.section}>
      {showSectionHeader ? (
        <View style={styles.sectionHeader}>
          {title ? <Text style={styles.title}>{title}</Text> : <View style={styles.titleSpacer} />}
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
      {horizontal ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    section: {
      marginBottom: Spacing.md,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.sm,
      gap: Spacing.sm,
    },
    title: {
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
    scrollContent: {
      paddingRight: Spacing.md,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: Spacing.sm,
      rowGap: 2,
    },
    gridHorizontal: {
      flexWrap: 'nowrap',
    },
    empty: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      paddingVertical: Spacing.sm,
    },
  });
}
