import { useAppTheme } from '@/src/theme/ThemeProvider';
import { Stack } from 'expo-router';

export default function FriendsTabLayout() {
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
      <Stack.Screen name="index" options={{ headerShown: false, title: 'Feed' }} />
      <Stack.Screen
        name="manage"
        options={{
          title: 'Friends',
          headerBackTitle: 'Feed',
        }}
      />
      <Stack.Screen
        name="friend/[id]"
        options={{
          title: 'Angler',
          headerBackTitle: 'Friends',
        }}
      />
    </Stack>
  );
}
