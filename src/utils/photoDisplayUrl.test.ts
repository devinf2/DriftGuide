import { describe, expect, it } from 'vitest';
import { layoutSizeToPixelSize, supabasePhotoThumbUrl } from './photoDisplayUrl';

describe('supabasePhotoThumbUrl', () => {
  it('transforms Supabase public object URLs', () => {
    const url =
      'https://abc.supabase.co/storage/v1/object/public/photos/user/trip/photo.jpg';
    const out = supabasePhotoThumbUrl(url, 216);
    expect(out).toBe(
      'https://abc.supabase.co/storage/v1/render/image/public/photos/user/trip/photo.jpg?width=216&height=216&resize=cover&quality=75',
    );
  });

  it('leaves local and non-Supabase URLs unchanged', () => {
    expect(supabasePhotoThumbUrl('file:///tmp/a.jpg', 100)).toBe('file:///tmp/a.jpg');
    expect(supabasePhotoThumbUrl('https://example.com/a.jpg', 100)).toBe('https://example.com/a.jpg');
  });

  it('does not double-transform render URLs', () => {
    const render =
      'https://abc.supabase.co/storage/v1/render/image/public/photos/a.jpg?width=100&height=100';
    expect(supabasePhotoThumbUrl(render, 200)).toBe(render);
  });
});

describe('layoutSizeToPixelSize', () => {
  it('scales layout dp by device pixel ratio', () => {
    expect(layoutSizeToPixelSize(72, 3)).toBe(216);
  });
});
