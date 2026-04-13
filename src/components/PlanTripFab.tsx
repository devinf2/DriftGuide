import { TAB_BAR_EXTRA } from '@/src/constants/mapTabChrome';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAddLocationFlowStore } from '@/src/stores/addLocationFlowStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const FAB_GAP_ABOVE_TAB = 12;
const FAB_SIZE = 64;
const ICON_SIZE = 36;

/** AI Guide: lift FAB above the message composer (input row + padding). — legacy; tab-bar mode ignores floating position. */
const GUIDE_COMPOSER_LIFT = 72;

type MenuAnchor = { x: number; y: number; width: number; height: number };
type MenuAnchorKind = 'fab' | 'tab';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.primaryDark,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 8,
      elevation: 8,
    },
    fabPressed: {
      opacity: 0.92,
      transform: [{ scale: 0.97 }],
    },
    menuOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.25)',
    },
    menuAnchorFab: {
      position: 'absolute',
      alignItems: 'flex-end',
    },
    menuAnchorTab: {
      position: 'absolute',
      left: Spacing.md,
      right: Spacing.md,
      alignItems: 'center',
    },
    menuCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.xs,
      minWidth: 0,
      maxWidth: Dimensions.get('window').width - Spacing.lg * 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 12,
    },
    menuTitle: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    menuRow: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
    },
    menuRowPressed: {
      opacity: 0.85,
    },
    menuRowText: {
      fontSize: FontSize.md,
      color: colors.text,
      fontWeight: '500',
    },
  });
}

let openPlanTripMenuFromTabBarImpl: (() => void) | null = null;

/** Middle tab “fish” — opens the same Go fishing menu without navigating. */
export function requestOpenPlanTripMenuFromTabBar() {
  openPlanTripMenuFromTabBarImpl?.();
}

type PlanTripFabProps = {
  /**
   * `floating` — legacy FAB above the tab bar (deprecated; not used from tabs layout).
   * `tabBar` — menu only, opened via middle tab (`requestOpenPlanTripMenuFromTabBar`).
   */
  placement?: 'floating' | 'tabBar';
};

export function PlanTripFab({ placement = 'floating' }: PlanTripFabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [menuAnchorKind, setMenuAnchorKind] = useState<MenuAnchorKind>('fab');
  const fabWrapRef = useRef<View>(null);
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const mapAddLocationOpen = useAddLocationFlowStore((s) => s.mapSheetActive);
  const tabBarMode = placement === 'tabBar';

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

  const hideDuringAddLocation =
    mapAddLocationOpen || pathname.includes('/trip/add-location');

  const hideOnTripSummary =
    /^\/journal\/[^/]+$/.test(pathname) || /\/trip\/[^/]+\/summary$/.test(pathname);

  const hideOnProfileSettings = pathname.includes('/profile/settings');

  const homeWithChatComposer = pathname === '/home' || pathname === '/guide';

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuAnchor(null);
  }, []);

  useEffect(() => {
    closeMenu();
  }, [pathname, closeMenu]);

  const openFabMenu = useCallback(() => {
    setMenuAnchorKind('fab');
    fabWrapRef.current?.measureInWindow((x, y, width, height) => {
      setMenuAnchor({ x, y, width, height });
      setMenuOpen(true);
    });
  }, []);

  const openMenuFromTabBar = useCallback(() => {
    if (hideDuringAddLocation) return;
    if (tabBarMode && homeWithChatComposer && keyboardOpen) return;
    setMenuAnchorKind('tab');
    setMenuAnchor(null);
    setMenuOpen(true);
  }, [hideDuringAddLocation, homeWithChatComposer, keyboardOpen, tabBarMode]);

  useEffect(() => {
    if (!tabBarMode) return;
    openPlanTripMenuFromTabBarImpl = openMenuFromTabBar;
    return () => {
      openPlanTripMenuFromTabBarImpl = null;
    };
  }, [tabBarMode, openMenuFromTabBar]);

  const onPlanTrip = useCallback(() => {
    closeMenu();
    router.push({ pathname: '/trip/new', params: { fromHome: '1' } });
  }, [closeMenu, router]);

  const onFishNow = useCallback(() => {
    closeMenu();
    router.push('/trip/fish-now');
  }, [closeMenu, router]);

  const onLogPastTrips = useCallback(() => {
    closeMenu();
    router.push('/trip/import-past');
  }, [closeMenu, router]);

  if (hideDuringAddLocation) {
    return null;
  }

  if (!tabBarMode) {
    if (hideOnTripSummary) return null;
    if (hideOnProfileSettings) return null;
    if (homeWithChatComposer && keyboardOpen) return null;
  }

  const tabBarBottomPad = Math.max(insets.bottom, 8);
  let floatingBottom = tabBarBottomPad + TAB_BAR_EXTRA + FAB_GAP_ABOVE_TAB;
  if (!tabBarMode && homeWithChatComposer) {
    floatingBottom += GUIDE_COMPOSER_LIFT;
  }

  const { width: winW, height: winH } = Dimensions.get('window');
  const menuBottomFab = menuAnchor != null ? winH - menuAnchor.y + 8 : 0;
  const menuRightFab =
    menuAnchor != null ? Math.max(Spacing.sm, winW - (menuAnchor.x + menuAnchor.width)) : Spacing.lg;

  const menuBottomTab = tabBarBottomPad + TAB_BAR_EXTRA + Spacing.sm;

  const menuCard = (
    <View style={styles.menuCard}>
      <Text style={styles.menuTitle}>Go fishing</Text>
      <Pressable style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]} onPress={onPlanTrip}>
        <Text style={styles.menuRowText}>Plan a Trip</Text>
      </Pressable>
      <Pressable style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]} onPress={onFishNow}>
        <Text style={styles.menuRowText}>Fish Now</Text>
      </Pressable>
      <Pressable style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]} onPress={onLogPastTrips}>
        <Text style={styles.menuRowText}>Log Past Trips</Text>
      </Pressable>
    </View>
  );

  return (
    <>
      {!tabBarMode ? (
        <View
          ref={fabWrapRef}
          collapsable={false}
          style={[styles.wrap, { bottom: floatingBottom }]}
          pointerEvents="box-none"
        >
          <Pressable
            style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
            onPress={openFabMenu}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Fishing actions"
            accessibilityHint="Opens plan a trip, fish now, or trips"
          >
            <MaterialCommunityIcons name="fish" size={ICON_SIZE} color={colors.textInverse} />
          </Pressable>
        </View>
      ) : null}

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable style={styles.menuOverlay} onPress={closeMenu}>
          {menuAnchorKind === 'fab' && menuAnchor != null ? (
            <View
              style={[styles.menuAnchorFab, { bottom: menuBottomFab, right: menuRightFab }]}
              onStartShouldSetResponder={() => true}
            >
              {menuCard}
            </View>
          ) : menuAnchorKind === 'tab' ? (
            <View style={[styles.menuAnchorTab, { bottom: menuBottomTab }]} onStartShouldSetResponder={() => true}>
              {menuCard}
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}
