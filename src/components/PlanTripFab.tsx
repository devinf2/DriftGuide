import { BorderRadius, Colors, Spacing } from '@/src/constants/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Approximate tab bar content height (icons + label); padding is in tabBarStyle. */
const TAB_BAR_EXTRA = 52;
const FAB_GAP_ABOVE_TAB = 12;
const FAB_SIZE = 64;
const ICON_SIZE = 36;

/** Space the map zoom / add controls need above the bottom of the map to clear this FAB. */
export const PLAN_TRIP_FAB_MAP_CLEARANCE = FAB_SIZE + FAB_GAP_ABOVE_TAB + Spacing.sm;

/** AI Guide: lift FAB above the message composer (input row + padding). */
const GUIDE_COMPOSER_LIFT = 72;

export function PlanTripFab() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(showEvt, () => setKeyboardOpen(true));
    const subHide = Keyboard.addListener(hideEvt, () => setKeyboardOpen(false));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  const hideOnProfile =
    pathname === '/profile' ||
    pathname.startsWith('/profile/');

  const isGuideTab = pathname === '/guide';

  if (hideOnProfile) {
    return null;
  }

  if (isGuideTab && keyboardOpen) {
    return null;
  }

  const tabBarBottomPad = Math.max(insets.bottom, 8);
  let bottom = tabBarBottomPad + TAB_BAR_EXTRA + FAB_GAP_ABOVE_TAB;
  if (isGuideTab) {
    bottom += GUIDE_COMPOSER_LIFT;
  }

  return (
    <View
      style={[styles.wrap, { bottom }]}
      pointerEvents="box-none"
    >
      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={() => router.push('/trip/new')}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Plan a trip"
      >
        <MaterialCommunityIcons name="fish" size={ICON_SIZE} color={Colors.textInverse} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: Spacing.lg,
    zIndex: 50,
    pointerEvents: 'box-none',
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  fabPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.97 }],
  },
});
