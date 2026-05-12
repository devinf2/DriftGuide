import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  OFFLINE_AUTH_EXPIRY_LEEWAY_SEC,
  stretchPersistedAuthSessionJsonForOfflineRead,
} from '@/src/services/supabaseAuthSessionStretch';

describe('stretchPersistedAuthSessionJsonForOfflineRead', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for invalid JSON', () => {
    expect(stretchPersistedAuthSessionJsonForOfflineRead('not-json')).toBeNull();
  });

  it('returns null when session shape is wrong', () => {
    expect(stretchPersistedAuthSessionJsonForOfflineRead(JSON.stringify({ foo: 1 }))).toBeNull();
  });

  it('bumps expires_at while preserving tokens', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    const raw = JSON.stringify({
      access_token: 'a',
      refresh_token: 'r',
      expires_at: 1,
      user: { id: 'u1' },
    });
    const out = stretchPersistedAuthSessionJsonForOfflineRead(raw);
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!) as { expires_at: number; access_token: string; refresh_token: string };
    expect(parsed.access_token).toBe('a');
    expect(parsed.refresh_token).toBe('r');
    expect(parsed.expires_at).toBe(Math.floor(Date.now() / 1000) + OFFLINE_AUTH_EXPIRY_LEEWAY_SEC);
  });
});
