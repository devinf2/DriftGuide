import { supabase } from './supabase';
import type { Fly, FlyCatalog, FlyColor, FlySize, FlyPresentation } from '@/src/types';

/** Fetch reference lists for pickers. */
export async function fetchFlyCatalog(): Promise<FlyCatalog[]> {
  const { data, error } = await supabase
    .from('fly_catalog')
    .select('*')
    .order('name');
  if (error) throw error;
  return (data ?? []) as FlyCatalog[];
}

export async function fetchFlyColors(): Promise<FlyColor[]> {
  const { data, error } = await supabase
    .from('fly_colors')
    .select('*')
    .order('name');
  if (error) throw error;
  return (data ?? []) as FlyColor[];
}

export async function fetchFlySizes(): Promise<FlySize[]> {
  const { data, error } = await supabase
    .from('fly_sizes')
    .select('*')
    .order('value');
  if (error) throw error;
  return (data ?? []) as FlySize[];
}

/** User's fly box: user_fly_box with joined fly_catalog, fly_colors, fly_sizes. Returns Fly[] for display. */
export async function fetchFlies(userId: string): Promise<Fly[]> {
  const { data, error } = await supabase
    .from('user_fly_box')
    .select(`
      id,
      user_id,
      fly_id,
      fly_color_id,
      fly_size_id,
      quantity,
      fly:fly_catalog(id, name, type, photo_url, presentation),
      fly_color:fly_colors(id, name),
      fly_size:fly_sizes(id, value)
    `)
    .eq('user_id', userId);

  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    user_id: string;
    fly_id: string;
    fly_color_id: string | null;
    fly_size_id: string | null;
    quantity?: number;
    fly: FlyCatalog | null;
    fly_color: FlyColor | null;
    fly_size: FlySize | null;
  }>;
  rows.sort((a, b) => (a.fly?.name ?? '').localeCompare(b.fly?.name ?? ''));

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    name: r.fly?.name ?? '',
    type: r.fly?.type ?? 'fly',
    size: r.fly_size?.value ?? null,
    color: r.fly_color?.name ?? null,
    photo_url: r.fly?.photo_url ?? null,
    presentation: r.fly?.presentation ?? null,
    quantity: r.quantity ?? 1,
    fly_id: r.fly_id,
    fly_color_id: r.fly_color_id,
    fly_size_id: r.fly_size_id,
  })) as Fly[];
}

/** Resolve color name to fly_color_id; insert color if missing. */
async function ensureFlyColorId(colorName: string | null | undefined): Promise<string | null> {
  if (!colorName?.trim()) return null;
  const { data: existing } = await supabase
    .from('fly_colors')
    .select('id')
    .eq('name', colorName.trim())
    .limit(1)
    .single();
  if (existing) return existing.id;
  const { data: inserted, error } = await supabase
    .from('fly_colors')
    .insert({ name: colorName.trim() })
    .select('id')
    .single();
  if (error) throw error;
  return inserted?.id ?? null;
}

/** Resolve size value to fly_size_id; insert size if missing. */
async function ensureFlySizeId(size: number | null | undefined): Promise<string | null> {
  if (size == null) return null;
  const { data: existing } = await supabase
    .from('fly_sizes')
    .select('id')
    .eq('value', size)
    .limit(1)
    .single();
  if (existing) return existing.id;
  const { data: inserted, error } = await supabase
    .from('fly_sizes')
    .insert({ value: size })
    .select('id')
    .single();
  if (error) throw error;
  return inserted?.id ?? null;
}

/** Ensure catalog has a fly by name+type; return fly_id. Creates if not exists (one pattern per name+type). */
async function ensureCatalogFly(params: {
  name: string;
  type: Fly['type'];
  presentation?: FlyPresentation | null;
  photo_url?: string | null;
}): Promise<string> {
  const { name, type, presentation, photo_url } = params;
  const { data: existing } = await supabase
    .from('fly_catalog')
    .select('id')
    .eq('name', name.trim())
    .eq('type', type)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    if (photo_url != null || presentation != null) {
      await supabase
        .from('fly_catalog')
        .update({
          ...(photo_url !== undefined && { photo_url: photo_url ?? null }),
          ...(presentation !== undefined && { presentation: presentation ?? null }),
        })
        .eq('id', existing.id);
    }
    return existing.id;
  }
  const { data: inserted, error } = await supabase
    .from('fly_catalog')
    .insert({
      name: name.trim(),
      type,
      presentation: presentation ?? null,
      photo_url: photo_url ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  if (!inserted?.id) throw new Error('Failed to create fly_catalog entry');
  return inserted.id;
}

export async function createFly(
  userId: string,
  input: {
    /** When adding from catalog, pass fly_id and (optionally) fly_color_id, fly_size_id. */
    fly_id?: string | null;
    /** When creating new pattern, pass name, type, presentation, photo_url; then color/size. */
    name?: string;
    type?: Fly['type'];
    size?: number | null;
    color?: string | null;
    presentation?: FlyPresentation | null;
    photo_url?: string | null;
    fly_color_id?: string | null;
    fly_size_id?: string | null;
    /** How many of this fly; default 1. */
    quantity?: number | null;
  }
): Promise<Fly> {
  let flyId: string;
  let flyColorId: string | null;
  let flySizeId: string | null;

  if (input.fly_id) {
    flyId = input.fly_id;
    flyColorId = input.fly_color_id ?? (await ensureFlyColorId(input.color));
    flySizeId = input.fly_size_id ?? (await ensureFlySizeId(input.size ?? null));
    if (input.photo_url != null) {
      await supabase.from('fly_catalog').update({ photo_url: input.photo_url }).eq('id', input.fly_id);
    }
  } else {
    flyId = await ensureCatalogFly({
      name: input.name ?? '',
      type: input.type ?? 'fly',
      presentation: input.presentation ?? null,
      photo_url: input.photo_url ?? null,
    });
    flyColorId = input.fly_color_id ?? (await ensureFlyColorId(input.color));
    flySizeId = input.fly_size_id ?? (await ensureFlySizeId(input.size ?? null));
  }

  const quantity = Math.max(1, input.quantity ?? 1);
  const { data, error } = await supabase
    .from('user_fly_box')
    .insert({
      user_id: userId,
      fly_id: flyId,
      fly_color_id: flyColorId,
      fly_size_id: flySizeId,
      quantity,
    })
    .select(`
      id,
      user_id,
      fly_id,
      fly_color_id,
      fly_size_id,
      quantity,
      fly:fly_catalog(id, name, type, photo_url, presentation),
      fly_color:fly_colors(id, name),
      fly_size:fly_sizes(id, value)
    `)
    .single();

  if (error) throw error;
  const r = data as {
    id: string;
    user_id: string;
    fly_id: string;
    fly_color_id: string | null;
    fly_size_id: string | null;
    quantity?: number;
    fly: FlyCatalog | null;
    fly_color: FlyColor | null;
    fly_size: FlySize | null;
  };
  return {
    id: r.id,
    user_id: r.user_id,
    name: r.fly?.name ?? '',
    type: r.fly?.type ?? 'fly',
    size: r.fly_size?.value ?? null,
    color: r.fly_color?.name ?? null,
    photo_url: r.fly?.photo_url ?? null,
    presentation: r.fly?.presentation ?? null,
    quantity: r.quantity ?? 1,
    fly_id: r.fly_id,
    fly_color_id: r.fly_color_id,
    fly_size_id: r.fly_size_id,
  } as Fly;
}

export async function updateFly(
  id: string,
  updates: {
    fly_id?: string;
    fly_color_id?: string | null;
    fly_size_id?: string | null;
    /** Resolved from color name when provided. */
    color?: string | null;
    size?: number | null;
    quantity?: number | null;
    /** When editing catalog fly (name/photo/presentation), pass fly_id and catalog fields. */
    name?: string;
    type?: Fly['type'];
    presentation?: FlyPresentation | null;
    photo_url?: string | null;
  }
): Promise<Fly> {
  const { data: entry } = await supabase
    .from('user_fly_box')
    .select('fly_id, user_id')
    .eq('id', id)
    .single();

  if (entry?.fly_id && (updates.name !== undefined || updates.presentation !== undefined || updates.photo_url !== undefined || updates.type !== undefined)) {
    await supabase
      .from('fly_catalog')
      .update({
        ...(updates.name !== undefined && { name: updates.name.trim() }),
        ...(updates.type !== undefined && { type: updates.type }),
        ...(updates.presentation !== undefined && { presentation: updates.presentation }),
        ...(updates.photo_url !== undefined && { photo_url: updates.photo_url }),
      })
      .eq('id', entry.fly_id);
  }

  const boxUpdate: Record<string, unknown> = {};
  if (updates.fly_id !== undefined) boxUpdate.fly_id = updates.fly_id;
  if (updates.fly_color_id !== undefined) {
    boxUpdate.fly_color_id = updates.fly_color_id;
  } else if (updates.color !== undefined) {
    boxUpdate.fly_color_id = await ensureFlyColorId(updates.color);
  }
  if (updates.fly_size_id !== undefined) {
    boxUpdate.fly_size_id = updates.fly_size_id;
  } else if (updates.size !== undefined) {
    boxUpdate.fly_size_id = await ensureFlySizeId(updates.size);
  }
  if (updates.quantity !== undefined) {
    boxUpdate.quantity = Math.max(1, updates.quantity);
  }

  if (Object.keys(boxUpdate).length === 0) {
    const flies = entry?.user_id ? await fetchFlies(entry.user_id) : [];
    const found = flies.find((f) => f.id === id);
    if (found) return found;
  }

  const { data, error } = await supabase
    .from('user_fly_box')
    .update(boxUpdate)
    .eq('id', id)
    .select(`
      id,
      user_id,
      fly_id,
      fly_color_id,
      fly_size_id,
      quantity,
      fly:fly_catalog(id, name, type, photo_url, presentation),
      fly_color:fly_colors(id, name),
      fly_size:fly_sizes(id, value)
    `)
    .single();

  if (error) throw error;
  const r = data as {
    id: string;
    user_id: string;
    fly_id: string;
    fly_color_id: string | null;
    fly_size_id: string | null;
    quantity?: number;
    fly: FlyCatalog | null;
    fly_color: FlyColor | null;
    fly_size: FlySize | null;
  };
  return {
    id: r.id,
    user_id: r.user_id,
    name: r.fly?.name ?? '',
    type: r.fly?.type ?? 'fly',
    size: r.fly_size?.value ?? null,
    color: r.fly_color?.name ?? null,
    photo_url: r.fly?.photo_url ?? null,
    presentation: r.fly?.presentation ?? null,
    quantity: r.quantity ?? 1,
    fly_id: r.fly_id,
    fly_color_id: r.fly_color_id,
    fly_size_id: r.fly_size_id,
  } as Fly;
}

export async function deleteFly(id: string): Promise<void> {
  const { error } = await supabase.from('user_fly_box').delete().eq('id', id);
  if (error) throw error;
}
