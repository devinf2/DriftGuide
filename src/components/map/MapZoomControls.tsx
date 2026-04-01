import { useMemo } from 'react';
import { View, Pressable, StyleSheet, Text } from 'react-native';
import { Spacing, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';

type Props = {
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export function MapZoomControls({ onZoomIn, onZoomOut }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createMapZoomStyles(colors), [colors]);
  return (
    <View style={styles.stack} pointerEvents="box-none">
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={onZoomIn}
        accessibilityLabel="Zoom in"
      >
        <Text style={styles.symbol}>+</Text>
      </Pressable>
      <View style={styles.divider} />
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={onZoomOut}
        accessibilityLabel="Zoom out"
      >
        <Text style={styles.symbol}>−</Text>
      </Pressable>
    </View>
  );
}

const BTN_SIZE = 44;

function createMapZoomStyles(colors: ThemeColors) {
  return StyleSheet.create({
    stack: {
      position: 'absolute',
      right: Spacing.md,
      bottom: Spacing.xl + 24,
      borderRadius: BorderRadius.md,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.12,
      shadowRadius: 3,
      elevation: 3,
    },
    button: {
      width: BTN_SIZE,
      height: BTN_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    buttonPressed: {
      backgroundColor: colors.background,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    symbol: {
      fontSize: 26,
      fontWeight: '500',
      color: colors.text,
      lineHeight: 28,
    },
  });
}
