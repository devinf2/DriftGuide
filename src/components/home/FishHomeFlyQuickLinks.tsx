import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  onOpenHatchCalendar: () => void;
  onMatchBug: () => void;
};

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginBottom: Spacing.md,
    },
    tile: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      borderRadius: BorderRadius.full,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      // Filled accent tiles so the two shortcuts read as the primary actions.
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    tileCalendar: {
      backgroundColor: colors.primary,
    },
    tileBug: {
      backgroundColor: colors.secondary,
    },
    label: {
      fontSize: FontSize.sm,
      fontWeight: '800',
      color: colors.textInverse,
      textAlign: 'center',
    },
  });
}

/** Combined Right-now tab shortcuts: jump to the full hatch calendar or match a bug by photo. */
export function FishHomeFlyQuickLinks({ onOpenHatchCalendar, onMatchBug }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.row}>
      <Pressable
        style={[styles.tile, styles.tileCalendar]}
        onPress={onOpenHatchCalendar}
        accessibilityRole="button"
        accessibilityLabel="Open the hatch calendar"
      >
        <MaterialCommunityIcons name="calendar-month" size={18} color={colors.textInverse} />
        <Text style={styles.label} numberOfLines={1}>
          Hatch calendar
        </Text>
      </Pressable>

      <Pressable
        style={[styles.tile, styles.tileBug]}
        onPress={onMatchBug}
        accessibilityRole="button"
        accessibilityLabel="Match a bug by photo"
      >
        <MaterialCommunityIcons name="camera" size={18} color={colors.textInverse} />
        <Text style={styles.label} numberOfLines={1}>
          Match a bug
        </Text>
      </Pressable>
    </View>
  );
}
