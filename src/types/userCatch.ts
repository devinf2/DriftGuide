/** Row shape for `user_catches` — `id` is always the client-generated UUID. */
export type UserCatchRow = {
  id: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  created_at?: string;
};

/** Pending outbox item (same fields needed for upsert). */
export type PendingUserCatch = UserCatchRow;
