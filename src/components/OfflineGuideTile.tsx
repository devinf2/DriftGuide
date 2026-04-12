import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export type OfflineGuideTileProps = {
  title: string;
  subtitle: string;
  onPress: () => void;
  colors: ThemeColors;
  style?: StyleProp<ViewStyle>;
};

export function OfflineGuideTile({ title, subtitle, onPress, colors, style }: OfflineGuideTileProps) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed, style]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.row}>
        <View style={styles.textCol}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
        <MaterialIcons name="chevron-right" size={22} color={colors.textTertiary} />
      </View>
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    tile: {
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    tilePressed: {
      opacity: 0.92,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    textCol: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    subtitle: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 2,
      letterSpacing: 0.15,
    },
  });
}
