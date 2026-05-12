/** Sign-in with email uses Supabase directly; otherwise username goes through Edge Function. */
export function isEmailIdentifier(raw: string): boolean {
  return raw.trim().includes('@');
}

/** Normalize @handle for username login (matches profiles.username rules). */
export function normalizeUsernameForLogin(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, '');
}

const USERNAME_LOGIN_RE = /^[a-z0-9_]{3,20}$/;

export function isValidUsernameForLogin(normalized: string): boolean {
  return USERNAME_LOGIN_RE.test(normalized);
}
