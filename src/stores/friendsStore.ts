import { create } from 'zustand';
import {
  acceptFriendRequest,
  deleteFriendship,
  fetchMyFriendships,
  fetchProfile,
  otherUserIdFromFriendship,
} from '@/src/services/friendsService';
import { supabase } from '@/src/services/supabase';
import type { FriendshipRow, Profile } from '@/src/types';

type FriendsState = {
  friendships: FriendshipRow[];
  profileByUserId: Record<string, Profile>;
  loading: boolean;
  error: string | null;
  reset: () => void;
  refresh: (userId: string | null) => Promise<void>;
  accept: (row: FriendshipRow) => Promise<boolean>;
  remove: (row: FriendshipRow) => Promise<boolean>;
};

export const useFriendsStore = create<FriendsState>((set, get) => ({
  friendships: [],
  profileByUserId: {},
  loading: false,
  error: null,

  reset: () => set({ friendships: [], profileByUserId: {}, loading: false, error: null }),

  refresh: async (userId: string | null) => {
    if (!userId) {
      set({ friendships: [], profileByUserId: {}, loading: false });
      return;
    }
    set({ loading: true, error: null });
    try {
      const friendships = await fetchMyFriendships();
      const ids = new Set<string>();
      for (const f of friendships) {
        ids.add(otherUserIdFromFriendship(f, userId));
      }
      const profileByUserId: Record<string, Profile> = { ...get().profileByUserId };
      for (const id of ids) {
        const p = await fetchProfile(id);
        if (p) profileByUserId[id] = p;
      }
      set({ friendships, profileByUserId, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to load friends',
      });
    }
  },

  accept: async (row: FriendshipRow) => {
    const ok = await acceptFriendRequest(row);
    if (ok) {
      const { data } = await supabase.auth.getUser();
      await get().refresh(data.user?.id ?? null);
    }
    return ok;
  },

  remove: async (row: FriendshipRow) => {
    const ok = await deleteFriendship(row);
    if (ok) {
      const { data } = await supabase.auth.getUser();
      await get().refresh(data.user?.id ?? null);
    }
    return ok;
  },
}));
