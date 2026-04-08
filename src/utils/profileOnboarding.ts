import type { Profile } from '@/src/types';

export function needsProfileOnboarding(profile: Profile | null): boolean {
  if (!profile) return false;
  return profile.onboarding_completed_at == null;
}
