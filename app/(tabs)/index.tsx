import { useEffect } from 'react';
import { useRouter } from 'expo-router';

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
