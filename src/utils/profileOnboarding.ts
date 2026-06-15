import type { Profile } from '@/src/types';

export function needsProfileOnboarding(profile: Profile | null): boolean {
  if (!profile) return false;
  return profile.onboarding_completed_at == null;
}

export type ProfileOnboardingInput = {
  firstName: string;
  lastName: string;
  /** Country name or ISO 3166-1 alpha-2 code. Required. */
  homeCountry: string;
  /** Region/state within the country. Optional. */
  homeRegion?: string;
};

/**
 * Pure validation for the onboarding form. First + last name and country are required;
 * region is optional (US users pick a state for it, others may leave it blank).
 */
export function validateProfileOnboarding(input: ProfileOnboardingInput): { error: string | null } {
  const fn = input.firstName.trim();
  const ln = input.lastName.trim();
  const hc = input.homeCountry.trim();
  if (!fn || !ln) return { error: 'Please enter your first and last name.' };
  if (!hc) return { error: 'Please choose your home country.' };
  return { error: null };
}
