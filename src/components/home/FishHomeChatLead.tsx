import { DriftGuideMessage } from '@/src/components/home/DriftGuideMessage';
import { FontSize, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    text: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 19,
      paddingTop: 2,
    },
  });
}

/** Thread-style prompt before the live chat composer. */
export function FishHomeChatLead() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <DriftGuideMessage>
      <Text style={styles.text}>Ask the guide anything below—I’ll use your waters and timing when it helps.</Text>
    </DriftGuideMessage>
  );
}
