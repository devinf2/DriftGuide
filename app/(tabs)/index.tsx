import { useRouter } from 'expo-router';
import { useEffect } from 'react';

/**
 * Redirect (tabs)/index to (tabs)/home so the Fish tab always shows the home stack.
 * Without this, some Expo Router versions may not resolve the default tab correctly.
 */
export default function IndexRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/home');
  }, [router]);
  return null;
}
