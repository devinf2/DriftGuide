import type { Profile } from '@/src/types';

export function profileDisplayName(profile: Profile | null | undefined): string {
  if (!profile) return 'Angler';
  const first = profile.first_name?.trim() ?? '';
  const last = profile.last_name?.trim() ?? '';
  const full = `${first} ${last}`.trim();
  return full || profile.display_name?.trim() || 'Angler';
}

/** First name for greetings; falls back to first token of display_name. */
export function profileFirstName(profile: Profile | null | undefined): string | null {
  if (!profile) return null;
  const first = profile.first_name?.trim();
  if (first) return first;
  const display = profile.display_name?.trim();
  if (display) {
    const token = display.split(/\s+/)[0];
    return token || null;
  }
  return null;
}

export function profileInitialLetter(profile: Profile | null | undefined): string {
  const name = profileDisplayName(profile);
  return name.charAt(0).toUpperCase() || 'A';
}
