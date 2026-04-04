import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type LinkedSpotRef = { id: string; name: string };

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      marginTop: Spacing.sm,
      gap: Spacing.xs,
    },
    label: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    chip: {
      backgroundColor: colors.primary,
      paddingVertical: 6,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.full,
    },
    chipText: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textInverse,
    },
    ambWrap: {
      marginTop: Spacing.xs,
      padding: Spacing.sm,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    ambTitle: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.warning,
      marginBottom: Spacing.xs,
    },
    ambLine: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      marginBottom: 4,
    },
  });
}

/** Tappable catalog waters resolved from the user’s message (extract + DB match). */
export function GuideChatLinkedSpots({
  linkedSpots,
  ambiguous,
  colors,
}: {
  linkedSpots?: LinkedSpotRef[] | null;
  ambiguous?: { extractedPhrase: string; candidates: LinkedSpotRef[] }[] | null;
  colors: ThemeColors;
}) {
  const router = useRouter();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (
    (!linkedSpots || linkedSpots.length === 0) &&
    (!ambiguous || ambiguous.length === 0)
  ) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      {linkedSpots && linkedSpots.length > 0 ? (
        <>
          <Text style={styles.label}>Open in DriftGuide</Text>
          <View style={styles.row}>
            {linkedSpots.map((s) => (
              <Pressable
                key={s.id}
                style={styles.chip}
                onPress={() => router.push(`/spot/${s.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${s.name}`}
              >
                <Text style={styles.chipText} numberOfLines={1}>
                  {s.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {ambiguous && ambiguous.length > 0
        ? ambiguous.map((a) => (
            <View key={a.extractedPhrase} style={styles.ambWrap}>
              <Text style={styles.ambTitle}>Which did you mean: “{a.extractedPhrase}”?</Text>
              <View style={styles.row}>
                {a.candidates.map((c) => (
                  <Pressable
                    key={c.id}
                    style={styles.chip}
                    onPress={() => router.push(`/spot/${c.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${c.name}`}
                  >
                    <Text style={styles.chipText} numberOfLines={1}>
                      {c.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        : null}
    </View>
  );
}
