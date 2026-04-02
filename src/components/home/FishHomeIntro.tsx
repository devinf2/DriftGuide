import { DriftGuideMessage } from '@/src/components/home/DriftGuideMessage';
import { useFishHomeStyles } from '@/src/components/home/fishHomeStyles';
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

export function FishHomeIntro({ userFirstName }: Props) {
  const { colors } = useAppTheme();
  const fishStyles = useFishHomeStyles();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        heroOuter: {
          borderRadius: BorderRadius.lg,
          overflow: 'hidden',
          marginBottom: Spacing.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          minHeight: HERO_MIN_HEIGHT,
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
          fontSize: FontSize.xxl,
          fontWeight: '700',
          color: colors.textInverse,
          lineHeight: 34,
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

  const blurb = `I've pulled today's fishing reports and conditions for your area. Surface activity looks strong — great day to hit the water. Here's what I've got for you:`;

  return (
    <DriftGuideMessage>
      <View>
        <View style={styles.heroOuter}>
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
            <Text style={styles.greeting}>
              {greetingLine}, {displayName}
            </Text>
            <Text style={styles.dateLine}>{dateStr}</Text>
          </View>
        </View>

        <View style={fishStyles.aiBubbleLike}>
          <Text style={styles.blurbText}>{blurb}</Text>
        </View>
      </View>
    </DriftGuideMessage>
  );
}
