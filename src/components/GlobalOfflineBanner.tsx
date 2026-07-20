import { FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSimulateOfflineStore } from '@/src/stores/simulateOfflineStore';
import { isAppReachableFromNetInfoState } from '@/src/utils/netReachability';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    // Overlay the top strip rather than taking layout space, so content isn't pushed down.
    bar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 1000,
      elevation: 1000,
      backgroundColor: colors.warning,
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.xs,
    },
    text: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.textInverse,
      textAlign: 'center',
    },
  });
}

/**
 * App-wide offline indicator (plan Phase 5a). Subscribes to NetInfo.
 */
export function GlobalOfflineBanner() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [netOffline, setNetOffline] = useState(false);
  const simulateOffline = useSimulateOfflineStore((s) => s.simulateOffline);

  useEffect(() => {
    const sub = NetInfo.addEventListener((s) => {
      setNetOffline(!isAppReachableFromNetInfoState(s));
    });
    void NetInfo.fetch().then((s) => {
      setNetOffline(!isAppReachableFromNetInfoState(s));
    });
    return () => sub();
  }, []);

  const offline = (__DEV__ && simulateOffline) || netOffline;

  if (!offline) return null;

  return (
    <View
      style={[styles.bar, { paddingTop: Math.max(insets.top, Spacing.xs) }]}
      accessibilityRole="alert"
    >
      <Text style={styles.text} numberOfLines={1}>
        {__DEV__ && simulateOffline
          ? 'Simulated offline — using saved data'
          : 'Offline mode — using saved data'}
      </Text>
    </View>
  );
}
