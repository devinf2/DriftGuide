import 'react-native-get-random-values';
import * as AppleAuthentication from 'expo-apple-authentication';

import { supabase } from '@/src/services/supabase';

export type AppleAuthResult =
  | { cancelled: true; error: null }
  | { cancelled: false; error: string | null };

function isAppleAuthCanceled(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code: string }).code === 'ERR_REQUEST_CANCELED'
  );
}

/** Native Sign in with Apple → Supabase session (iOS). */
export async function signInWithAppleNative(): Promise<AppleAuthResult> {
  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    return { cancelled: false, error: 'Sign in with Apple is not available on this device.' };
  }

  try {
    // Do not pass a custom `nonce` here: Expo → Apple → JWT hashing often disagrees with
    // GoTrue’s nonce check and surfaces as "Nonces mismatch". Omitting nonce matches
    // Supabase’s Expo guide and avoids that failure mode.
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      return { cancelled: false, error: 'Apple did not return an identity token.' };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });

    if (error) return { cancelled: false, error: error.message };

    // Apple only sends full name on first authorization; persist for profile + auth metadata.
    const { givenName, familyName, middleName } = credential.fullName ?? {};
    const nameParts = [givenName, middleName, familyName].filter(
      (p): p is string => typeof p === 'string' && p.trim().length > 0,
    );
    const fullName = nameParts.join(' ').trim();

    if (fullName || givenName || familyName) {
      await supabase.auth.updateUser({
        data: {
          ...(fullName ? { full_name: fullName } : {}),
          ...(givenName ? { given_name: givenName } : {}),
          ...(familyName ? { family_name: familyName } : {}),
        },
      });

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        const fn = givenName?.trim() ?? '';
        const ln = familyName?.trim() ?? '';
        const display_name = [fn, ln].filter(Boolean).join(' ') || fullName || undefined;
        await supabase
          .from('profiles')
          .update({
            ...(fn ? { first_name: fn } : {}),
            ...(ln ? { last_name: ln } : {}),
            ...(display_name ? { display_name } : {}),
          })
          .eq('id', user.id);
      }
    }

    return { cancelled: false, error: null };
  } catch (e) {
    if (isAppleAuthCanceled(e)) return { cancelled: true, error: null };
    const msg = e instanceof Error ? e.message : 'Apple sign-in failed';
    return { cancelled: false, error: msg };
  }
}
