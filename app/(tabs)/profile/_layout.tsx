import { useAppTheme } from '@/src/theme/ThemeProvider';
import { Stack } from 'expo-router';

export default function ProfileTabLayout() {
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
      <Stack.Screen name="index" options={{ headerShown: false, title: 'Profile' }} />
      <Stack.Screen
        name="offline-maps"
        options={{
          title: 'Offline maps',
          headerBackTitle: 'Profile',
        }}
      />
      <Stack.Screen
        name="stats"
        options={{
          title: 'Stats',
          headerBackTitle: 'Profile',
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          title: 'Settings',
          headerBackTitle: 'Profile',
        }}
      />
    </Stack>
  );
}
