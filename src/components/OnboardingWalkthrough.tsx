import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { Image } from 'expo-image';
import { useMemo, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ASSET TODO: dedicated walkthrough illustrations don't exist yet — reusing bundled
// species/fly artwork as stand-ins. Swap these for purpose-built screens when available.
type WalkthroughCard = {
  key: string;
  title: string;
  body: string;
  image: number;
};

const CARDS: readonly WalkthroughCard[] = [
  {
    key: 'browse',
    title: 'Find your water',
    body: 'Browse fishing spots near you, check conditions, and plan where to drift next.',
    image: require('@/assets/images/species/rainbow-trout.png'),
  },
  {
    key: 'log',
    title: 'Log every catch',
    body: 'Record the fish you land — species, size, and the fly that fooled them.',
    image: require('@/assets/images/flies/adams.png'),
  },
  {
    key: 'journal',
    title: 'See your story',
    body: 'Your journal and stats build up over time so you can spot what works.',
    image: require('@/assets/images/species/brown-trout.png'),
  },
];

function createStyles(colors: ThemeColors, cardWidth: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
    },
    skip: { fontSize: FontSize.md, color: colors.textSecondary, fontWeight: '600' },
    card: {
      width: cardWidth,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.xl,
    },
    imageWrap: {
      width: cardWidth * 0.6,
      height: cardWidth * 0.6,
      borderRadius: BorderRadius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.xl,
      overflow: 'hidden',
    },
    image: { width: '78%', height: '78%' },
    cardTitle: {
      fontSize: FontSize.xl,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginBottom: Spacing.sm,
    },
    cardBody: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
    },
    footer: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl },
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.lg,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.lg,
      alignItems: 'center',
    },
    primaryBtnText: { color: colors.textInverse, fontSize: FontSize.lg, fontWeight: '700' },
  });
}

export type OnboardingWalkthroughProps = {
  /** Called when the user taps Skip or finishes the last card. */
  onDone: () => void;
};

/** Skippable swipeable intro cards shown to brand-new users before the empty cold-start. */
export function OnboardingWalkthrough({ onDone }: OnboardingWalkthroughProps) {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors, width), [colors, width]);
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  };

  const isLast = index >= CARDS.length - 1;

  const handleNext = () => {
    if (isLast) {
      onDone();
      return;
    }
    const next = index + 1;
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
    setIndex(next);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onDone} hitSlop={12}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={{ flex: 1 }}
      >
        {CARDS.map((card) => (
          <View key={card.key} style={styles.card}>
            <View style={styles.imageWrap}>
              <Image source={card.image} style={styles.image} contentFit="contain" />
            </View>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.cardBody}>{card.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {CARDS.map((card, i) => (
            <View
              key={card.key}
              style={[
                styles.dot,
                { backgroundColor: i === index ? colors.primary : colors.border },
              ]}
            />
          ))}
        </View>
        <Pressable style={styles.primaryBtn} onPress={handleNext}>
          <Text style={styles.primaryBtnText}>{isLast ? 'Get started' : 'Next'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
