import { BorderRadius, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { type ReactNode, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';

const LOGO = require('@/assets/images/logo.png');

type Props = {
  children: ReactNode;
};

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.xs,
      marginBottom: Spacing.md,
      maxWidth: '100%',
    },
    avatar: {
      width: 28,
      height: 28,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.surface,
      marginTop: 2,
    },
    body: {
      flex: 1,
      minWidth: 0,
    },
  });
}

/**
 * Left-aligned row: DriftGuide avatar + content (chat-thread style).
 */
export function DriftGuideMessage({ children }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <Image source={LOGO} style={styles.avatar} accessibilityLabel="DriftGuide" />
      <View style={styles.body}>{children}</View>
    </View>
  );
}
