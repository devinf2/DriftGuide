// Re-export trip summary so journal entries open inside the Journal tab (tab bar stays visible).
// useLocalSearchParams() will receive { id } from the /journal/[id] route.
export { default } from '../../trip/[id]/summary';
