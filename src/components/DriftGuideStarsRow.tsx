import { type ThemeColors } from '@/src/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

type Props = {
  /** 0–5 display value (fractional allowed for partial stars). */
  stars: number;
  colors: ThemeColors;
  /** Glyph size in dp. */
  size?: number;
  /** Filled / partial star color. */
  fillColor?: string;
  /** Empty star outline color. */
  emptyColor?: string;
};

/**
 * Same 5-star rendering as the spot screen composite tile: full, partial, and outline stars.
 */
export function DriftGuideStarsRow({
  stars,
  colors,
  size = 18,
  fillColor = colors.warning,
  emptyColor = colors.border,
}: Props) {
  const s = Math.max(0, Math.min(5, stars));
  return (
    <View style={styles.row}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fullStars = Math.floor(s);
        const partial = s - fullStars;
        const isFull = i < fullStars;
        const isPartial = i === fullStars && partial > 0.05;
        if (isFull) {
          return <Ionicons key={i} name="star" size={size} color={fillColor} />;
        }
        if (isPartial) {
          return (
            <View key={i} style={[styles.partialWrap, { width: size, height: size }]}>
              <Ionicons name="star-outline" size={size} color={emptyColor} style={styles.outlineBg} />
              <View style={[styles.partialFill, { width: size * partial }]}>
                <Ionicons name="star" size={size} color={fillColor} />
              </View>
            </View>
          );
        }
        return <Ionicons key={i} name="star-outline" size={size} color={emptyColor} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  partialWrap: {
    position: 'relative',
  },
  outlineBg: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  partialFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
  },
});

/** Map model confidence (0–10) to the same 0–5 star scale as DriftGuide composite scores. */
export function confidenceToGuideStars(confidence010: number): number {
  const c = Math.max(0, Math.min(10, confidence010));
  return (c / 10) * 5;
}
