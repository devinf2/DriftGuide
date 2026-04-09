import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Edge Functions expect the project anon key in `apikey` plus the user JWT in `Authorization`.
 * On React Native, passing only `Authorization` can leave `apikey` unset on the wire and yield 401.
 */
export function edgeFunctionInvokeHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (supabaseAnonKey) headers.apikey = supabaseAnonKey;
  return headers;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
