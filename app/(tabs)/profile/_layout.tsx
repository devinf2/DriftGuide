import { Stack } from 'expo-router';

export default function ProfileTabLayout() {
  return (
    <Stack
      initialRouteName="index"
      screenOptions={{
        headerStyle: { backgroundColor: '#2C4670' },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { color: '#FFFFFF', fontWeight: '600' },
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
