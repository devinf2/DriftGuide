import { supabase } from '@/src/services/supabase';
import type { FriendshipRow, FriendshipStatus, Profile } from '@/src/types';

export function orderedFriendshipPair(userA: string, userB: string) {
  return userA < userB
    ? { profile_min: userA, profile_max: userB }
    : { profile_min: userB, profile_max: userA };
}

export async function fetchMyFriendships(): Promise<FriendshipRow[]> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from('friendships')
    .select('*')
    .or(`profile_min.eq.${uid},profile_max.eq.${uid}`);

  if (error) {
    console.warn('[fetchMyFriendships]', error);
    return [];
  }
  return (data as FriendshipRow[]) ?? [];
}

export function otherUserIdFromFriendship(row: FriendshipRow, myId: string): string {
  return row.profile_min === myId ? row.profile_max : row.profile_min;
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) {
    console.warn('[fetchProfile]', error);
    return null;
  }
  return data as Profile | null;
}

export async function lookupProfileByFriendCode(code: string): Promise<Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'friend_code'> | null> {
  const trimmed = code.trim();
  if (trimmed.length < 2) return null;

  const { data, error } = await supabase.rpc('lookup_profile_by_friend_code', { p_code: trimmed });
  if (error) {
    console.warn('[lookupProfileByFriendCode]', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) return null;
  return row as Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'friend_code'>;
}

export async function setMyFriendCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('set_my_friend_code', { p_code: code });
  if (error) throw error;
  return data as string;
}

/** True if the code is already the 4–5 alphanumeric short format (case-insensitive). */
export function isShortFriendCode(code: string): boolean {
  const t = code.trim().toLowerCase();
  return /^[a-z0-9]{4,5}$/.test(t);
}

/** Replaces a legacy long friend code with a generated short code (server allows once). */
export async function migrateLegacyFriendCode(): Promise<string> {
  const { data, error } = await supabase.rpc('migrate_legacy_friend_code');
  if (error) throw error;
  return data as string;
}

export type ProfileDiscoveryRow = Pick<
  Profile,
  'id' | 'display_name' | 'avatar_url' | 'friend_code' | 'username'
>;

/** Search other profiles by @username, display name, or first/last name (min 2 characters). */
export async function searchProfilesForDiscovery(
  query: string,
  limit = 20,
): Promise<ProfileDiscoveryRow[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const { data, error } = await supabase.rpc('search_profiles_for_discovery', {
    p_query: trimmed,
    p_limit: limit,
  });
  if (error) {
    console.warn('[searchProfilesForDiscovery]', error);
    throw new Error(error.message);
  }
  return (data as ProfileDiscoveryRow[]) ?? [];
}

export async function sendFriendRequest(fromUserId: string, toUserId: string): Promise<{ ok: boolean; message?: string }> {
  if (fromUserId === toUserId) return { ok: false, message: 'Cannot add yourself' };
  const { profile_min, profile_max } = orderedFriendshipPair(fromUserId, toUserId);

  const { error } = await supabase.from('friendships').insert({
    profile_min,
    profile_max,
    status: 'pending',
    requested_by: fromUserId,
  });

  if (error) {
    if (error.code === '23505') return { ok: false, message: 'Request already exists' };
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

export async function acceptFriendRequest(row: FriendshipRow): Promise<boolean> {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' as FriendshipStatus, updated_at: new Date().toISOString() })
    .eq('profile_min', row.profile_min)
    .eq('profile_max', row.profile_max)
    .eq('status', 'pending');

  if (error) {
    console.warn('[acceptFriendRequest]', error);
    return false;
  }
  return true;
}

export async function deleteFriendship(row: FriendshipRow): Promise<boolean> {
  const { error } = await supabase
    .from('friendships')
    .delete()
    .eq('profile_min', row.profile_min)
    .eq('profile_max', row.profile_max);

  if (error) {
    console.warn('[deleteFriendship]', error);
    return false;
  }
  return true;
}

export async function blockUser(row: FriendshipRow, blockerId: string): Promise<boolean> {
  const { error } = await supabase
    .from('friendships')
    .update({
      status: 'blocked' as FriendshipStatus,
      requested_by: blockerId,
      updated_at: new Date().toISOString(),
    })
    .eq('profile_min', row.profile_min)
    .eq('profile_max', row.profile_max);

  if (error) {
    console.warn('[blockUser]', error);
    return false;
  }
  return true;
}
