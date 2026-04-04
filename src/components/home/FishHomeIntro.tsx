import { DriftGuideMessage } from '@/src/components/home/DriftGuideMessage';
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

const HERO_IMAGE = require('@/assets/images/home-hero.png');

/** Shorter hero; image anchored bottom so the top of the photo is cropped. */
const HERO_MIN_HEIGHT = 152;

type Props = {
  userFirstName?: string | null;
  /** While home hot spots / briefing are loading */
  briefingLoading?: boolean;
  /** Number of nearby waters we ranked (0 if none) */
  rankedWatersCount?: number;
};

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatTodayLong(): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

function capitalizeWord(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function FishHomeIntro({
  userFirstName,
  briefingLoading = false,
  rankedWatersCount = 0,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        compoundCard: {
          alignSelf: 'stretch',
          borderRadius: BorderRadius.lg,
          overflow: 'hidden',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        },
        heroStack: {
          minHeight: HERO_MIN_HEIGHT,
          overflow: 'hidden',
        },
        blurbBlock: {
          backgroundColor: colors.surface,
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.md,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
        heroImage: {
          ...StyleSheet.absoluteFillObject,
          width: '100%',
          height: '100%',
        },
        heroContent: {
          padding: Spacing.lg,
          paddingBottom: Spacing.md,
          justifyContent: 'flex-end',
          minHeight: HERO_MIN_HEIGHT,
        },
        labelRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.xs,
          marginTop: Spacing.sm,
          marginBottom: Spacing.sm,
        },
        labelText: {
          fontSize: FontSize.xs,
          fontWeight: '800',
          color: colors.secondary,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          textShadowColor: 'rgba(0,0,0,0.55)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 4,
        },
        greeting: {
          fontSize: FontSize.xl,
          fontWeight: '700',
          color: colors.textInverse,
          lineHeight: Math.round(FontSize.xl * 1.25),
          fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: undefined }),
          textShadowColor: 'rgba(0,0,0,0.65)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 10,
        },
        dateLine: {
          marginTop: Spacing.xs,
          fontSize: FontSize.sm,
          color: 'rgba(255,255,255,0.92)',
          textShadowColor: 'rgba(0,0,0,0.6)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 6,
        },
        fishIconShadow: {
          textShadowColor: 'rgba(0,0,0,0.55)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 4,
        },
        blurbText: {
          fontSize: FontSize.md,
          color: colors.text,
          lineHeight: 22,
        },
      }),
    [colors],
  );

  const displayName = capitalizeWord(userFirstName?.trim() || 'angler');
  const dateStr = formatTodayLong();
  const greetingLine = timeGreeting();

  const blurb = briefingLoading
    ? 'Checking live weather, flow, and regional hatch notes for your area…'
    : rankedWatersCount > 0
      ? `I've pulled live conditions and DriftGuide community context for ${rankedWatersCount} nearby water${rankedWatersCount === 1 ? '' : 's'}. Here's what looks strongest right now:`
      : 'Turn on location or browse the map to rank nearby waters. You can still ask the guide anything below.';

  return (
    <DriftGuideMessage>
      <View style={styles.compoundCard}>
        <View style={styles.heroStack}>
          <Image
            source={HERO_IMAGE}
            style={styles.heroImage}
            contentFit="cover"
            contentPosition="bottom"
          />
          <View style={styles.heroContent}>
            <View style={styles.labelRow}>
              <MaterialCommunityIcons
                name="fish"
                size={18}
                color={colors.secondary}
                style={styles.fishIconShadow}
              />
              <Text style={styles.labelText}>AI Fishing Guide</Text>
            </View>
            <Text
              style={styles.greeting}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.65}
            >
              {greetingLine}, {displayName}
            </Text>
            <Text style={styles.dateLine}>{dateStr}</Text>
          </View>
        </View>
        <View style={styles.blurbBlock}>
          <Text style={styles.blurbText}>{blurb}</Text>
        </View>
      </View>
    </DriftGuideMessage>
  );
}
