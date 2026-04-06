import { useEffect, useState } from 'react';
import { resolveTripPhotoUri } from '@/src/services/tripPhotoOfflineCache';

/**
 * Resolves a remote Supabase photo URL to a local `file://` copy when the trip photo
 * offline cache has downloaded it; otherwise returns the remote URL.
 */
export function useResolvedTripPhotoUri(remoteUrl: string | null | undefined): string | null | undefined {
  const [uri, setUri] = useState<string | null | undefined>(remoteUrl ?? undefined);

  useEffect(() => {
    if (remoteUrl == null || remoteUrl === '') {
      setUri(remoteUrl ?? undefined);
      return;
    }
    let cancelled = false;
    resolveTripPhotoUri(remoteUrl).then((u) => {
      if (!cancelled) setUri(u);
    });
    return () => {
      cancelled = true;
    };
  }, [remoteUrl]);

  return uri;
}
