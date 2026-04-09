import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

/**
 * Resolve the authenticated user's id from the access token.
 * Kong `verify_jwt` + publishable keys / ES256 tokens can 401 before the worker runs; callers
 * should set `verify_jwt = false` in config.toml and rely on this instead.
 */
export async function resolveAuthedUserId(
  supabaseUrl: string,
  anonKey: string,
  authHeader: string,
  accessToken: string,
): Promise<string | null> {
  const supabaseUser = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: authHeader, apikey: anonKey },
    },
  });

  const { data: claimData, error: claimsErr } = await supabaseUser.auth.getClaims(accessToken);
  const fromClaims =
    claimData?.claims && typeof (claimData.claims as { sub?: unknown }).sub === "string"
      ? (claimData.claims as { sub: string }).sub
      : "";
  if (fromClaims) return fromClaims;

  if (claimsErr) {
    console.warn("[resolveUserId] getClaims failed, trying getUser", claimsErr.message);
  }

  const {
    data: { user },
    error: userErr,
  } = await supabaseUser.auth.getUser(accessToken);
  if (userErr || !user?.id) {
    console.warn("[resolveUserId] getUser failed", userErr?.message ?? "no user");
    return null;
  }
  return user.id;
}
