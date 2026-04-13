import { BorderRadius, Spacing } from '@/src/constants/theme';
import { requestOpenPlanTripMenuFromTabBar } from '@/src/components/PlanTripFab';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import { StyleSheet, View } from 'react-native';

const CIRCLE = 52;
const CENTER_ICON = 28;

export function FishActionsTabButton(props: BottomTabBarButtonProps) {
  const { colors } = useAppTheme();
  const { children: _children, onPress: _onPress, style, ...rest } = props;

  return (
    <PlatformPressable
      {...rest}
      accessibilityLabel="Plan or start fishing"
      accessibilityHint="Opens plan a trip, fish now, or log past trips"
      style={[styles.slot, style]}
      onPress={() => requestOpenPlanTripMenuFromTabBar()}
    >
      <View style={[styles.circle, { backgroundColor: colors.primary }]}>
        <MaterialCommunityIcons name="hook" size={CENTER_ICON} color={colors.textInverse} />
      </View>
    </PlatformPressable>
  );
}

const styles = StyleSheet.create({
  slot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: Spacing.xs,
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
});
