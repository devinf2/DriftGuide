import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useTripStore } from '@/src/stores/tripStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * App-wide "uploading from cache" indicator, pinned to the top on every screen (like
 * GlobalOfflineBanner). Shows whenever trips saved on this device are still waiting to sync.
 * Uses an indeterminate sliding bar — a single trip upload has no granular percentage.
 *
 * Stacks below GlobalOfflineBanner: when offline that banner already consumes the safe-area
 * top inset, so we only add it ourselves when we're the top-most element (online + uploading).
 */
export function GlobalUploadIndicator() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const pendingSyncTrips = useTripStore((s) => s.pendingSyncTrips);
  const activeTrip = useTripStore((s) => s.activeTrip);
  const isOnline = useTripStore((s) => s.isOnline);

  // Only count trips that have ended. A trip started offline is queued into
  // pendingSyncTrips while still active — don't surface the uploading bar until it's over.
  const pendingCount = useMemo(() => {
    const activeId = activeTrip?.status === 'active' ? activeTrip.id : null;
    return pendingSyncTrips.filter((id) => id !== activeId).length;
  }, [pendingSyncTrips, activeTrip]);

  const anim = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    if (pendingCount === 0) return;
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, pendingCount]);

  // Only surface the bar for an ended trip that can actually upload right now.
  if (pendingCount === 0 || !isOnline) return null;

  const segmentWidth = Math.max(trackWidth * 0.4, 1);
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-segmentWidth, trackWidth],
  });

  const noun = `${pendingCount} trip${pendingCount !== 1 ? 's' : ''}`;
  const label = `Uploading ${noun} from this device…`;

  return (
    <View
      style={[styles.bar, { paddingTop: Math.max(insets.top, Spacing.sm) }]}
      accessibilityRole="alert"
    >
      <View
        style={styles.track}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        {trackWidth > 0 ? (
          <Animated.View
            style={[styles.segment, { width: segmentWidth, transform: [{ translateX }] }]}
          />
        ) : null}
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    bar: {
      backgroundColor: colors.surface,
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    track: {
      height: 3,
      width: '100%',
      backgroundColor: colors.borderLight,
      borderRadius: BorderRadius.full,
      overflow: 'hidden',
    },
    segment: {
      height: 3,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.primary,
    },
    label: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: Spacing.xs,
    },
  });
}
