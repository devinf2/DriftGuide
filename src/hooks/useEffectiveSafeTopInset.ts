import { Spacing } from '@/src/constants/theme';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * When the global offline banner is visible, the navigator already sits below the status bar;
 * screens must not add `insets.top` again or content is pushed down twice.
 */
export function useEffectiveSafeTopInset(): number {
  const insets = useSafeAreaInsets();
  const { isConnected } = useNetworkStatus();
  return useMemo(() => (isConnected ? insets.top : Spacing.sm), [isConnected, insets.top]);
}
