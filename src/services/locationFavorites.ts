import { supabase } from '@/src/services/supabase';

export async function fetchFavoriteLocationIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_favorite_locations')
    .select('location_id')
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.location_id as string);
}

export async function addFavoriteLocation(userId: string, locationId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('user_favorite_locations').insert({
    user_id: userId,
    location_id: locationId,
  });
  if (error) return { error: error.message };
  return { error: null };
}

export async function removeFavoriteLocation(userId: string, locationId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('user_favorite_locations')
    .delete()
    .eq('user_id', userId)
    .eq('location_id', locationId);
  if (error) return { error: error.message };
  return { error: null };
}
