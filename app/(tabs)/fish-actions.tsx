import { useAppTheme } from '@/src/theme/ThemeProvider';
import { View } from 'react-native';

/**
 * This route exists so the tab navigator can show a middle “fish” slot.
 * The tab uses a custom bar button that opens the Go fishing menu instead of navigating here.
 */
export default function FishActionsTabScreen() {
  const { colors } = useAppTheme();
  return <View style={{ flex: 1, backgroundColor: colors.background }} />;
}
