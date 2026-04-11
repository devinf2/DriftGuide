/** Client-only timeline row upload state (not stored in Postgres). */
export type EventSyncStatus = 'pending' | 'syncing' | 'synced' | 'error';
