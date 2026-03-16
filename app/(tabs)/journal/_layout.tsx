import { Stack } from 'expo-router';

export default function JournalLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Journal' }} />
      <Stack.Screen name="[id]" options={{ title: 'Journal Entry' }} />
    </Stack>
  );
}
