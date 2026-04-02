import { Spacing } from '@/src/constants/theme';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignSelf: 'stretch',
    marginBottom: Spacing.md,
  },
});

type Props = {
  children: ReactNode;
};

/**
 * Home briefing section wrapper: full-width block with modest space below (no side logo).
 */
export function DriftGuideMessage({ children }: Props) {
  return <View style={styles.wrap}>{children}</View>;
}
