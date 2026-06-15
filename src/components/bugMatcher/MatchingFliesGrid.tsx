import { View, Text, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import { displayFlyName } from '@/src/utils/flyValidation';

/**
 * Render a list of fly NAMES as cards (bundled image + name + optional size hint).
 * Names that don't resolve to a bundled image still render with a placeholder so an
 * AI-suggested pattern we don't have art for is not silently dropped.
 */
export function MatchingFliesGrid({
  flyNames,
  sizeHint,
  colors,
}: {
  flyNames: string[];
  /** Optional size span to show under each fly, e.g. "#16–22". */
  sizeHint?: string | null;
  colors: ThemeColors;
}) {
  const styles = createStyles(colors);
  if (flyNames.length === 0) {
    return <Text style={styles.empty}>No matching flies listed.</Text>;
  }
  return (
    <View style={styles.grid}>
      {flyNames.map((name) => {
        const source = getBundledFlyImageSource(name);
        return (
          <View key={name} style={styles.card}>
            {source ? (
              <Image source={source} style={styles.image} resizeMode="contain" />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Ionicons name="bug-outline" size={22} color={colors.textTertiary} />
              </View>
            )}
            <Text style={styles.name} numberOfLines={2}>
              {displayFlyName(name)}
            </Text>
            {sizeHint ? <Text style={styles.size}>{sizeHint}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.sm,
    },
    card: {
      width: '31%',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.sm,
      alignItems: 'center',
    },
    image: {
      width: '100%',
      height: 56,
      marginBottom: Spacing.xs,
    },
    imagePlaceholder: {
      width: '100%',
      height: 56,
      marginBottom: Spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: {
      fontSize: FontSize.xs,
      color: colors.text,
      textAlign: 'center',
      fontWeight: '600',
    },
    size: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    empty: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      fontStyle: 'italic',
    },
  });
}
