import { Alert } from 'react-native';
import type { Profile, Trip, TripPhotoVisibility } from '@/src/types';

export type { TripPhotoVisibility };

export const TRIP_PHOTO_VISIBILITY_LABELS: Record<TripPhotoVisibility, string> = {
  private: 'Private',
  friends_only: 'Friends only',
  public: 'Public',
};

/** Shorter labels for compact triggers (e.g. trip summary bar). */
export const TRIP_PHOTO_VISIBILITY_TRIGGER_LABELS: Record<TripPhotoVisibility, string> = {
  private: 'Private',
  friends_only: 'Friends',
  public: 'Public',
};

/** Short line shown under each option in pickers. */
export const TRIP_PHOTO_VISIBILITY_HINTS: Record<TripPhotoVisibility, string> = {
  private: 'Only you on your profile',
  friends_only: 'Accepted friends on your profile',
  public: 'Any DriftGuide user on your profile',
};

export const TRIP_PHOTO_VISIBILITY_INFO_TITLE = 'Trip photos on your profile';

export const TRIP_PHOTO_VISIBILITY_INFO_BODY =
  'This controls who can see trip photos when someone opens your profile. Private means only you. Friends only means accepted friends. Public means any signed-in DriftGuide user.\n\nIt does not change your journal or trip timeline. You can set a default here and override per trip after a trip ends.';

export function showTripPhotoVisibilityInfoAlert() {
  Alert.alert(TRIP_PHOTO_VISIBILITY_INFO_TITLE, TRIP_PHOTO_VISIBILITY_INFO_BODY);
}

/** Resolved visibility for a trip (trip override or profile default). */
export function effectiveTripPhotoVisibility(
  trip: Pick<Trip, 'trip_photo_visibility'>,
  profile: Pick<Profile, 'default_trip_photo_visibility'> | null | undefined,
): TripPhotoVisibility {
  return trip.trip_photo_visibility ?? profile?.default_trip_photo_visibility ?? 'private';
}
