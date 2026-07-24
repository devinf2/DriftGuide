import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { LocationType } from '@/src/types';

/** What a dropped pin can become. `business` is not a location type but shares the rail. */
export type PlaceKind = LocationType | 'business';

type IconLib = 'mci' | 'ion';
type RailItem = { kind: PlaceKind; label: string; lib: IconLib; icon: string };

/** Two rows of four: waters, then access/parking/business. */
const RAIL_ITEMS: RailItem[] = [
  { kind: 'river', label: 'River', lib: 'mci', icon: 'waves-arrow-right' },
  { kind: 'stream', label: 'Stream', lib: 'mci', icon: 'wave' },
  { kind: 'lake', label: 'Lake', lib: 'mci', icon: 'waves' },
  { kind: 'reservoir', label: 'Reservoir', lib: 'mci', icon: 'hydro-power' },
  { kind: 'pond', label: 'Pond', lib: 'mci', icon: 'water-circle' },
  { kind: 'access_point', label: 'Access', lib: 'mci', icon: 'hiking' },
  { kind: 'parking', label: 'Parking', lib: 'mci', icon: 'parking' },
  { kind: 'business', label: 'Business', lib: 'ion', icon: 'storefront' },
];

function RailIcon({ item, color }: { item: RailItem; color: string }) {
  if (item.lib === 'ion') {
    return <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={22} color={color} />;
  }
  return (
    <MaterialCommunityIcons
      name={item.icon as keyof typeof MaterialCommunityIcons.glyphMap}
      size={22}
      color={color}
    />
  );
}

type Props = {
  onSelect: (kind: PlaceKind) => void;
  onCancel: () => void;
};

/**
 * Shown right after the user drops a pin (long-press): a bottom card of type choices —
 * two rows of four — to pick what the pin is before filling in the form.
 */
export function AddTypeRail({ onSelect, onCancel }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {/* marginBottom clears the Mapbox logo tucked into the bottom-left corner. */}
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>What are you adding?</Text>
          <Pressable
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel adding"
            hitSlop={8}
          >
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {RAIL_ITEMS.map((item) => (
            <Pressable
              key={item.kind}
              style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
              onPress={() => onSelect(item.kind)}
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.label}`}
            >
              <View style={styles.iconCircle}>
                <RailIcon item={item} color={colors.primary} />
              </View>
              <Text style={styles.label} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      paddingHorizontal: Spacing.sm,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
      marginHorizontal: Spacing.md,
      marginBottom: 34,
      alignSelf: 'stretch',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    title: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    closeBtn: {
      padding: 2,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cell: {
      width: '25%',
      alignItems: 'center',
      paddingVertical: Spacing.sm,
      gap: 6,
    },
    iconCircle: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: colors.primary + '14',
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.text,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
