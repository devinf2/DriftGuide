import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/src/services/supabase';

/** Parse query + hash (OAuth tokens often arrive in the fragment). */
function getOAuthParamsFromUrl(url: string): { params: Record<string, string>; errorCode: string | null } {
  const parsed = new URL(url, 'https://phony.example');
  const errorCode = parsed.searchParams.get('errorCode');
  parsed.searchParams.delete('errorCode');
  const params: Record<string, string> = Object.fromEntries(parsed.searchParams);
  if (parsed.hash) {
    new URLSearchParams(parsed.hash.replace(/^#/, '')).forEach((value, key) => {
      params[key] = value;
    });
  }
  return { params, errorCode };
}

/** Matches Supabase OAuth / magic-link / password-recovery returns (query or hash tokens, or PKCE code). */
function looksLikeOAuthReturn(url: string): boolean {
  return (
    url.includes('access_token=') ||
    url.includes('refresh_token=') ||
    (url.includes('code=') && (url.includes('auth/callback') || url.includes('callback'))) ||
    (url.includes('type=recovery') &&
      (url.includes('access_token=') || url.includes('refresh_token=') || url.includes('code=')))
  );
}

/**
 * Deep link used for Google OAuth, password recovery emails, and any auth callback to this app.
 * Add this exact URL to Supabase Dashboard → Authentication → URL configuration → Redirect URLs.
 */
export function getAuthCallbackRedirectUri(): string {
  return Linking.createURL('auth/callback', { scheme: 'driftguide' });
}

export function getGoogleOAuthRedirectUri(): string {
  return getAuthCallbackRedirectUri();
}

/** True when this URL is a Supabase password-recovery redirect (fragment or query). */
export function isPasswordRecoveryDeepLink(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes('type=recovery');
}

export async function applyOAuthReturnUrl(url: string): Promise<void> {
  if (!looksLikeOAuthReturn(url)) return;

  const { params, errorCode } = getOAuthParamsFromUrl(url);
  if (errorCode) throw new Error(String(errorCode));

  const code = typeof params.code === 'string' ? params.code : undefined;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const access_token = typeof params.access_token === 'string' ? params.access_token : undefined;
  const refresh_token = typeof params.refresh_token === 'string' ? params.refresh_token : undefined;
  if (!access_token || !refresh_token) {
    throw new Error('Sign-in redirect did not include a session. Check Supabase redirect URL allow list.');
  }

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
}

export type GoogleOAuthResult = { cancelled: true; error: null } | { cancelled: false; error: string | null };

export async function signInWithGoogleOAuth(): Promise<GoogleOAuthResult> {
  const redirectTo = getGoogleOAuthRedirectUri();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      // Force Google’s account picker instead of silently reusing the last session (ASWebAuthenticationSession / Safari).
      queryParams: { prompt: 'select_account' },
    },
  });

  if (error) return { cancelled: false, error: error.message };
  if (!data?.url) return { cancelled: false, error: 'Could not start Google sign-in.' };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { cancelled: true, error: null };
  }

  if (result.type !== 'success' || !result.url) {
    return { cancelled: false, error: 'Google sign-in was not completed.' };
  }

  try {
    await applyOAuthReturnUrl(result.url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Google sign-in failed';
    return { cancelled: false, error: msg };
  }

  return { cancelled: false, error: null };
}
