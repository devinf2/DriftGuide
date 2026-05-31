import { describe, expect, it } from 'vitest';
import type { CatchData, Photo } from '@/src/types';
import {
  buildAlbumPhotoUrlsByCatchId,
  normalizeCatchPhotoUrls,
  resolveCatchDisplayPhotoUrls,
  resolveCatchHeroPhotoUrl,
} from './catchPhotos';

describe('buildAlbumPhotoUrlsByCatchId', () => {
  it('groups album URLs by catch_id in display order', () => {
    const photos = [
      {
        id: '1',
        user_id: 'u',
        trip_id: 't',
        catch_id: 'catch-a',
        url: 'https://x/a2.jpg',
        display_order: 1,
        created_at: '2026-01-02T00:00:00Z',
      },
      {
        id: '2',
        user_id: 'u',
        trip_id: 't',
        catch_id: 'catch-a',
        url: 'https://x/a1.jpg',
        display_order: 0,
        created_at: '2026-01-01T00:00:00Z',
      },
    ] as Photo[];

    const map = buildAlbumPhotoUrlsByCatchId(photos);
    expect(map.get('catch-a')).toEqual(['https://x/a1.jpg', 'https://x/a2.jpg']);
  });
});

describe('resolveCatchDisplayPhotoUrls', () => {
  const eventData: CatchData = {
    species: 'Brown Trout',
    photo_urls: ['https://event/old.jpg'],
    photo_url: 'https://event/old.jpg',
  };

  it('prefers album URLs when present', () => {
    const album = new Map<string, string[]>([['catch-1', ['https://album/new.jpg']]]);
    expect(resolveCatchDisplayPhotoUrls('catch-1', eventData, album)).toEqual(['https://album/new.jpg']);
  });

  it('falls back to event JSON when album has no rows', () => {
    expect(resolveCatchDisplayPhotoUrls('catch-1', eventData)).toEqual(normalizeCatchPhotoUrls(eventData));
  });
});

describe('resolveCatchHeroPhotoUrl', () => {
  it('returns first resolved URL', () => {
    const album = new Map<string, string[]>([['catch-1', ['https://album/new.jpg', 'https://album/2.jpg']]]);
    expect(
      resolveCatchHeroPhotoUrl(
        'catch-1',
        { photo_urls: ['https://event/old.jpg'], photo_url: 'https://event/old.jpg' },
        album,
      ),
    ).toBe('https://album/new.jpg');
  });
});
