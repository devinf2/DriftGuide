import { TAB_BAR_EXTRA } from '@/src/constants/mapTabChrome';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useRequireAuth } from '@/src/auth/useRequireAuth';
import { useAddLocationFlowStore } from '@/src/stores/addLocationFlowStore';
import { useAuthStore } from '@/src/stores/authStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    sheetBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: BorderRadius.lg,
      borderTopRightRadius: BorderRadius.lg,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
    },
    sheetInner: { gap: Spacing.md },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: Spacing.xs,
    },
    postCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.background,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
    },
    postAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface },
    postAvatarFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    postCardText: { flex: 1 },
    postCardTitle: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    postCardSub: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 1 },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.background,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
    },
    actionIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionTitle: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: colors.text },
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
  const requireAuth = useRequireAuth();
  const mapAddLocationOpen = useAddLocationFlowStore((s) => s.mapSheetActive);
  const profile = useAuthStore((s) => s.profile);
  const avatarUrl = profile?.avatar_url ?? null;
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
    // Trips are account-bound: a guest must sign in before planning/starting one (WS-B).
    if (!requireAuth('Sign in to plan a trip.')) return;
    router.push({ pathname: '/trip/new', params: { fromHome: '1' } });
  }, [closeMenu, requireAuth, router]);

  const onFishNow = useCallback(() => {
    closeMenu();
    if (!requireAuth('Sign in to start a trip.')) return;
    router.push('/trip/fish-now');
  }, [closeMenu, requireAuth, router]);

  const onLogPastTrips = useCallback(() => {
    closeMenu();
    if (!requireAuth('Sign in to log past trips.')) return;
    router.push('/trip/import-past');
  }, [closeMenu, requireAuth, router]);

  // Bug Matcher is an offline reference tool (no account needed); no auth gate.
  const onMatchBug = useCallback(() => {
    closeMenu();
    router.push('/bug-matcher');
  }, [closeMenu, router]);

  // Posting is account-bound (RLS); guests sign in first (WS-B).
  const onCreatePost = useCallback(() => {
    closeMenu();
    if (!requireAuth('Sign in to post to the feed.')) return;
    router.push('/post/new');
  }, [closeMenu, requireAuth, router]);

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

  const actionRows: {
    key: string;
    title: string;
    icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
    color: string;
    onPress: () => void;
  }[] = [
    { key: 'plan', title: 'Plan a Trip', icon: 'calendar-check', color: '#3B7DAE', onPress: onPlanTrip },
    { key: 'fishNow', title: 'Fish Now', icon: 'hook', color: '#2E9E5B', onPress: onFishNow },
    { key: 'import', title: 'Import a trip', icon: 'tray-arrow-down', color: '#C9742E', onPress: onLogPastTrips },
    { key: 'matchBug', title: 'Match a bug', icon: 'bug', color: '#7E57C2', onPress: onMatchBug },
  ];

  const createSheet = (
    <View style={styles.sheetInner}>
      <View style={styles.grabber} />

      <Pressable
        style={({ pressed }) => [styles.postCard, pressed && styles.menuRowPressed]}
        onPress={onCreatePost}
        accessibilityRole="button"
        accessibilityLabel="Create a post"
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.postAvatar} contentFit="cover" />
        ) : (
          <View style={[styles.postAvatar, styles.postAvatarFallback]}>
            <MaterialCommunityIcons name="fish" size={22} color={colors.primary} />
          </View>
        )}
        <View style={styles.postCardText}>
          <Text style={styles.postCardTitle}>Create a post</Text>
          <Text style={styles.postCardSub}>What&apos;s on your mind?</Text>
        </View>
        <MaterialCommunityIcons name="image-multiple" size={24} color={colors.secondary} />
      </Pressable>

      {actionRows.map((r) => (
        <Pressable
          key={r.key}
          style={({ pressed }) => [styles.actionRow, pressed && styles.menuRowPressed]}
          onPress={r.onPress}
          accessibilityRole="button"
          accessibilityLabel={r.title}
        >
          <View style={[styles.actionIcon, { backgroundColor: `${r.color}22` }]}>
            <MaterialCommunityIcons name={r.icon} size={24} color={r.color} />
          </View>
          <Text style={styles.actionTitle}>{r.title}</Text>
          <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textTertiary} />
        </Pressable>
      ))}
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

      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={closeMenu}>
        <Pressable style={styles.sheetBackdrop} onPress={closeMenu}>
          <Pressable
            style={[styles.sheet, { paddingBottom: tabBarBottomPad + Spacing.lg }]}
            onPress={() => {}}
          >
            {createSheet}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
