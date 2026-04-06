import { FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sub = NetInfo.addEventListener((s) => {
      setOffline(!isAppReachableFromNetInfoState(s));
    });
    void NetInfo.fetch().then((s) => {
      setOffline(!isAppReachableFromNetInfoState(s));
    });
    return () => sub();
  }, []);

  if (!offline) return null;

  return (
    <View
      style={[styles.bar, { paddingTop: Math.max(insets.top, Spacing.sm) }]}
      accessibilityRole="alert"
    >
      <Text style={styles.text}>Offline mode</Text>
      <Text style={styles.sub}>Using saved data where available — reconnect for live reports.</Text>
    </View>
  );
}
