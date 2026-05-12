import { Stack } from 'expo-router';

import { useAppTheme } from '@/src/theme/ThemeProvider';

export default function AuthLayout() {
  const { colors } = useAppTheme();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="reset-password"
        options={{
          headerShown: true,
          title: 'New password',
          headerBackVisible: false,
          gestureEnabled: false,
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: colors.textInverse,
          headerTitleStyle: { color: colors.textInverse, fontWeight: '600' },
        }}
      />
    </Stack>
  );
}
