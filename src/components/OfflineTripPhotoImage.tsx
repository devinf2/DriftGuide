import { Image, type ImageProps } from 'expo-image';
import { useResolvedTripPhotoUri } from '@/src/hooks/useResolvedTripPhotoUri';

type Props = Omit<ImageProps, 'source'> & {
  /** Remote `https://` URL from the `photos` table (or catch gallery). */
  remoteUri: string;
};

/**
 * Renders a trip/library photo using expo-image disk cache, preferring the on-device
 * copy from {@link reconcileTripPhotoCache} when present.
 */
export function OfflineTripPhotoImage({ remoteUri, ...rest }: Props) {
  const resolved = useResolvedTripPhotoUri(remoteUri);
  const uri = resolved ?? remoteUri;
  return (
    <Image
      {...rest}
      source={{ uri }}
      cachePolicy="memory-disk"
      recyclingKey={remoteUri}
    />
  );
}
