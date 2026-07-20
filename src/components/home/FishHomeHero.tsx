import { FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { Image } from 'expo-image';
import { useMemo, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

const HERO_IMAGE = require('@/assets/images/home-hero.png');

/** Persistent hero photo — kept compact so the content sheet below gets more of the screen. */
const HERO_HEIGHT_RATIO = 0.6;
const HERO_HEIGHT_MIN = 410;
const HERO_HEIGHT_MAX = 600;
/** Keep the greeting's first line clear of the bell in the top-right. */
const BELL_CLEARANCE = 56;

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function capitalizeWord(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

type Props = {
  userFirstName?: string | null;
  /** Section pill tabs, rendered on the photo just under the greeting. */
  tabs?: ReactNode;
  /** Always-visible notifications bell (caller wires the badge + tap). */
  bell: ReactNode;
  /** Streak/milestone badge, shown under the bell. */
  streakBadge?: ReactNode;
  topInset: number;
  /** Reports the tabs' bottom Y within the hero, so the sheet can collapse up to just under them. */
  onTabsLayout?: (bottomY: number) => void;
};

function createStyles(colors: ThemeColors, heroHeight: number) {
  return StyleSheet.create({
    hero: {
      height: heroHeight,
      justifyContent: 'flex-start',
      overflow: 'hidden',
      backgroundColor: colors.primaryDark,
    },
    heroImage: {
      ...StyleSheet.absoluteFillObject,
    },
    bellWrap: {
      position: 'absolute',
      right: Spacing.md,
      alignItems: 'flex-end',
      gap: Spacing.sm,
      zIndex: 3,
    },
    heroContent: {
      paddingLeft: Spacing.lg,
      paddingRight: BELL_CLEARANCE,
    },
    greeting: {
      fontSize: FontSize.xxxl,
      fontWeight: '700',
      color: colors.textInverse,
      lineHeight: Math.round(FontSize.xxxl * 1.12),
      fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: undefined }),
      textShadowColor: 'rgba(0,0,0,0.65)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 10,
    },
    // Pills sit on the photo just under the greeting.
    heroTabs: {
      marginTop: Spacing.md,
    },
  });
}

/**
 * The Fish home's persistent top header: the fisherman photo with the greeting near the top
 * and an always-visible bell. Only the sheet below it changes as the user moves between tabs.
 */
export function FishHomeHero({
  userFirstName,
  tabs,
  bell,
  streakBadge,
  topInset,
  onTabsLayout,
}: Props) {
  const { colors } = useAppTheme();
  const { height } = useWindowDimensions();
  const heroHeight = Math.max(
    HERO_HEIGHT_MIN,
    Math.min(HERO_HEIGHT_MAX, Math.round(height * HERO_HEIGHT_RATIO)),
  );
  const styles = useMemo(() => createStyles(colors, heroHeight), [colors, heroHeight]);

  const displayName = capitalizeWord(userFirstName?.trim() || 'angler');

  return (
    <View style={styles.hero}>
      <Image source={HERO_IMAGE} style={styles.heroImage} contentFit="cover" contentPosition="center" />

      <View style={[styles.bellWrap, { top: topInset + Spacing.sm }]}>
        {bell}
        {streakBadge}
      </View>

      <View style={[styles.heroContent, { paddingTop: topInset + Spacing.md }]}>
        <Text style={styles.greeting} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
          {timeGreeting()}, {displayName}
        </Text>
      </View>
      {/* Full-bleed so the pill row scrolls edge-to-edge instead of being squeezed by the bell gutter. */}
      {tabs ? (
        <View
          style={styles.heroTabs}
          onLayout={(e) =>
            onTabsLayout?.(e.nativeEvent.layout.y + e.nativeEvent.layout.height)
          }
        >
          {tabs}
        </View>
      ) : null}
    </View>
  );
}
