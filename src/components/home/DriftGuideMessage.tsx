import { Spacing } from '@/src/constants/theme';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignSelf: 'stretch',
    marginBottom: Spacing.md,
  },
  wrapCompactAfter: {
    marginBottom: Spacing.xs,
  },
});

type Props = {
  children: ReactNode;
  /** Tighter gap before the next section (e.g. Up next → Hatch). */
  compactAfter?: boolean;
};

/**
 * Home briefing section wrapper: full-width block with modest space below (no side logo).
 */
export function DriftGuideMessage({ children, compactAfter }: Props) {
  return <View style={[styles.wrap, compactAfter && styles.wrapCompactAfter]}>{children}</View>;
}
