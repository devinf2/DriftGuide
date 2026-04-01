import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function PhotosRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/profile');
  }, [router]);
  return null;
}
