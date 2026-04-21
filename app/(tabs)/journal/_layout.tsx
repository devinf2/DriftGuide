import { Stack } from 'expo-router';

export default function JournalLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Trips' }} />
      <Stack.Screen
        name="[id]"
        getId={({ params }) => {
          const id = params?.id;
          return typeof id === 'string' && id.length > 0 ? id : undefined;
        }}
        options={{
          title: 'Trip',
        }}
      />
      <Stack.Screen name="create-group" options={{ title: 'Group trips' }} />
    </Stack>
  );
}
