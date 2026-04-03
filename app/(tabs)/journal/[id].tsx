// Re-export trip summary so trips open inside the Trips tab (tab bar stays visible).
// useLocalSearchParams() will receive { id } from the /journal/[id] route.
export { default } from '../../trip/[id]/summary';
