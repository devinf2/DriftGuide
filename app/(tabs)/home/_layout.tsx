import { Stack } from 'expo-router';

export default function HomeTabLayout() {
  return (
    <Stack
      initialRouteName="index"
      screenOptions={{
        headerStyle: { backgroundColor: '#2C4670' },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { color: '#FFFFFF', fontWeight: '600' },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false, title: 'Home' }} />
      <Stack.Screen
        name="photos"
        options={{
          title: 'Photo Library',
          headerBackTitle: 'Back',
        }}
      />
    </Stack>
  );
}
