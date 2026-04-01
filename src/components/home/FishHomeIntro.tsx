import { DriftGuideMessage } from '@/src/components/home/DriftGuideMessage';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    bubble: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.sm + 2,
      paddingHorizontal: Spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    title: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    body: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: Spacing.xs,
      lineHeight: 19,
    },
  });
}

export function FishHomeIntro({ displayName }: { displayName: string | null }) {
  const greeting = `${getTimeGreeting()}${displayName ? `, ${displayName}` : ''}`;
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <DriftGuideMessage>
      <View style={styles.bubble}>
        <Text style={styles.title}>{greeting}</Text>
        <Text style={styles.body}>
          I’ve pulled an update on today’s fishing outlook for your area—hatches, picks below, and full spot reports when
          you’re ready.
        </Text>
      </View>
    </DriftGuideMessage>
  );
}
