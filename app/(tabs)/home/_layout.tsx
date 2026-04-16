import { useAppTheme } from '@/src/theme/ThemeProvider';
import { Stack } from 'expo-router';

export default function HomeTabLayout() {
  const { colors } = useAppTheme();

  return (
    <Stack
      initialRouteName="index"
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.textInverse,
        headerTitleStyle: { color: colors.textInverse, fontWeight: '600' },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false, title: 'Home' }} />
      <Stack.Screen name="hatch-chart" options={{ title: 'Hatch calendar', headerShown: true }} />
    </Stack>
  );
}
