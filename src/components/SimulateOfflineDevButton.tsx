/**
 * UI for dev simulate-offline. Loaded only via `src/dev/OfflineSimOverlay.tsx` in development.
 */
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { useSimulateOfflineStore } from '@/src/stores/simulateOfflineStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Toggles app-wide "offline" for testing without changing system network.
 * Render only when `__DEV__` (see root layout).
 */
export function SimulateOfflineDevButton() {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const simulateOffline = useSimulateOfflineStore((s) => s.simulateOffline);
  const toggle = useSimulateOfflineStore((s) => s.toggleSimulateOffline);

  return (
    <Pressable
      onPress={toggle}
      style={({ pressed }) => [
        styles.wrap,
        {
          // Bottom-left: avoids overlap with Plan Trip FAB (bottom-right on tab screens).
          bottom: Math.max(insets.bottom, 8) + 52 + 12,
          left: Spacing.md,
          backgroundColor: simulateOffline ? colors.warning : colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.88 : 1,
        },
      ]}
      accessibilityLabel={
        simulateOffline ? 'Turn off simulated offline mode' : 'Simulate offline mode'
      }
      accessibilityRole="button"
    >
      <Text
        style={[
          styles.label,
          { color: simulateOffline ? colors.textInverse : colors.textSecondary },
        ]}
        numberOfLines={1}
      >
        {simulateOffline ? 'Sim offline ON' : 'Sim offline'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignSelf: 'flex-start',
    zIndex: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 160,
  },
  label: {
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
});
