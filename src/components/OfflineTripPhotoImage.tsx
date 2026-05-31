import { Image, type ImageProps } from 'expo-image';
import { useMemo, useState } from 'react';
import { useResolvedTripPhotoUri } from '@/src/hooks/useResolvedTripPhotoUri';
import { supabasePhotoThumbUrl } from '@/src/utils/photoDisplayUrl';

type Props = Omit<ImageProps, 'source'> & {
  /** Remote `https://` URL from the `photos` table (or catch gallery). */
  remoteUri: string;
  /** Request a resized Supabase render URL for faster thumbnail loads (full-size when omitted). */
  maxPixelSize?: number;
};

/**
 * Renders a trip/library photo using expo-image disk cache, preferring the on-device
 * copy from {@link reconcileTripPhotoCache} when present.
 */
export function OfflineTripPhotoImage({ remoteUri, maxPixelSize, onError, ...rest }: Props) {
  const resolved = useResolvedTripPhotoUri(remoteUri);
  const [thumbTransformFailed, setThumbTransformFailed] = useState(false);
  const uri = useMemo(() => {
    const base = resolved ?? remoteUri;
    if (maxPixelSize && base.startsWith('http') && !thumbTransformFailed) {
      return supabasePhotoThumbUrl(base, maxPixelSize, rest.contentFit === 'contain' ? 'contain' : 'cover');
    }
    return base;
  }, [resolved, remoteUri, maxPixelSize, rest.contentFit, thumbTransformFailed]);

  const source = useMemo(() => {
    if (maxPixelSize && uri.startsWith('file://')) {
      return { uri, width: maxPixelSize, height: maxPixelSize };
    }
    return { uri };
  }, [uri, maxPixelSize]);

  return (
    <Image
      {...rest}
      source={source}
      cachePolicy="memory-disk"
      recyclingKey={remoteUri}
      transition={120}
      onError={(e) => {
        if (maxPixelSize && !thumbTransformFailed && uri !== (resolved ?? remoteUri)) {
          setThumbTransformFailed(true);
        }
        onError?.(e);
      }}
    />
  );
}
