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
    bar: {
      backgroundColor: colors.warning,
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.sm,
    },
    text: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.textInverse,
      textAlign: 'center',
    },
    sub: {
      marginTop: 2,
      fontSize: FontSize.xs,
      fontWeight: '500',
      color: colors.textInverse,
      textAlign: 'center',
      opacity: 0.95,
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
      style={[styles.bar, { paddingTop: Math.max(insets.top, Spacing.sm) }]}
      accessibilityRole="alert"
    >
      <Text style={styles.text}>
        {__DEV__ && simulateOffline ? 'Simulated offline' : 'Offline mode'}
      </Text>
      <Text style={styles.sub}>
        {__DEV__ && simulateOffline
          ? 'Dev toggle — using saved data where available.'
          : 'Using saved data where available — reconnect for live reports.'}
      </Text>
    </View>
  );
}
