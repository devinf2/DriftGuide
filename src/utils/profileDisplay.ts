import type { Profile } from '@/src/types';

export function profileDisplayName(profile: Profile | null | undefined): string {
  if (!profile) return 'Angler';
  const first = profile.first_name?.trim() ?? '';
  const last = profile.last_name?.trim() ?? '';
  const full = `${first} ${last}`.trim();
  return full || profile.display_name?.trim() || 'Angler';
}

export function profileInitialLetter(profile: Profile | null | undefined): string {
  const name = profileDisplayName(profile);
  return name.charAt(0).toUpperCase() || 'A';
}
