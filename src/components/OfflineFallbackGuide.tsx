import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import raw from '@/src/data/offlineFallbackGuide.json';

type Section = { heading: string; bullets: string[] };

type GuideJson = {
  title: string;
  subtitle: string;
  sections: Section[];
};

const guide = raw as GuideJson;

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    title: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    subtitle: {
      marginTop: Spacing.xs,
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    section: {
      marginTop: Spacing.md,
    },
    heading: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.secondary,
      marginBottom: Spacing.xs,
    },
    bullet: {
      fontSize: FontSize.sm,
      color: colors.text,
      lineHeight: 20,
      marginLeft: Spacing.sm,
      marginTop: 4,
    },
  });
}

/** Bundled sectioned tips when fully offline / no cached intel (plan Phase 5c2). */
export function OfflineFallbackGuide() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{guide.title}</Text>
      <Text style={styles.subtitle}>{guide.subtitle}</Text>
      {guide.sections.map((sec) => (
        <View key={sec.heading} style={styles.section}>
          <Text style={styles.heading}>{sec.heading}</Text>
          {sec.bullets.map((b, i) => (
            <Text key={i} style={styles.bullet}>
              • {b}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
