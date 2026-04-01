import { Redirect } from 'expo-router';

/** AI Guide merged into Fish (home); keep route for bookmarks. */
export default function GuideRedirectScreen() {
  return <Redirect href="/home" />;
}
