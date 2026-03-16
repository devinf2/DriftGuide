import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function PhotosRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/home/photos');
  }, [router]);
  return null;
}
