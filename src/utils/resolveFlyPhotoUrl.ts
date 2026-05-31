import type { ImageSourcePropType } from 'react-native';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import type { Fly, FlyCatalog, FlyChangeData } from '@/src/types';

/** True when URL is a user-uploaded fly photo (not a stale catalog reference in cache). */
export function isUserFlyPhotoUrl(url: string | null | undefined): boolean {
  const u = url?.trim();
  if (!u) return false;
  if (u.startsWith('file://') || u.startsWith('content://') || u.startsWith('ph://')) return true;
  return /\/flies\/|fly[-_]?photos?|user_fly|storage\/v1\/object/i.test(u);
}

export function resolveFlyImageSourceForFly(
  fly: Pick<Fly, 'name' | 'photo_url' | 'fly_id'>,
  catalog: FlyCatalog[] = [],
): ImageSourcePropType | null {
  if (isUserFlyPhotoUrl(fly.photo_url)) {
    return { uri: fly.photo_url!.trim() };
  }
  const bundled = getBundledFlyImageSource(fly.name);
  if (bundled) return bundled;
  const catalogFly =
    (fly.fly_id ? catalog.find((c) => c.id === fly.fly_id) : null) ??
    catalog.find((c) => c.name === fly.name);
  const catalogUrl = catalogFly?.photo_url?.trim();
  if (catalogUrl) return { uri: catalogUrl };
  return null;
}

export function resolveFlyPhotoUrl(
  pattern: string,
  size: number | null,
  color: string | null,
  userBoxFlyId: string | null,
  catalogFlyId: string | null,
  userFlies: Fly[],
  catalog: FlyCatalog[],
  /** Denormalized snapshot from fly_change event */
  snapshotUrl?: string | null,
): string | null {
  if (snapshotUrl?.trim()) return snapshotUrl.trim();
  if (userBoxFlyId) {
    const fromBox = userFlies.find((f) => f.id === userBoxFlyId);
    if (fromBox?.photo_url?.trim()) return fromBox.photo_url.trim();
  }
  if (catalogFlyId) {
    const fromCatalog = catalog.find((c) => c.id === catalogFlyId);
    if (fromCatalog?.photo_url?.trim()) return fromCatalog.photo_url.trim();
  }
  const pat = pattern.trim();
  if (!pat) return null;
  const fromBoxMatch = userFlies.find(
    (f) => f.name === pat && (f.size ?? null) === size && (f.color ?? null) === color,
  );
  if (fromBoxMatch?.photo_url?.trim()) return fromBoxMatch.photo_url.trim();
  const fromCatalogName = catalog.find((c) => c.name === pat);
  return fromCatalogName?.photo_url?.trim() ?? null;
}

export function resolveFlyPhotoUrlFromFly(fly: Fly | null | undefined): string | null {
  return fly?.photo_url?.trim() ?? null;
}

export function resolveFlyImageSourceFromPhotoUrl(
  pattern: string,
  photoUrl: string | null | undefined,
): ImageSourcePropType | null {
  if (isUserFlyPhotoUrl(photoUrl)) return { uri: photoUrl!.trim() };
  return getBundledFlyImageSource(pattern);
}

export function resolveFlyImageSource(
  pattern: string,
  size: number | null,
  color: string | null,
  userBoxFlyId: string | null,
  catalogFlyId: string | null,
  userFlies: Fly[],
  catalog: FlyCatalog[],
  snapshotUrl?: string | null,
): ImageSourcePropType | null {
  return resolveFlyImageSourceFromPhotoUrl(
    pattern,
    resolveFlyPhotoUrl(
      pattern,
      size,
      color,
      userBoxFlyId,
      catalogFlyId,
      userFlies,
      catalog,
      snapshotUrl,
    ),
  );
}

export function resolveFlyImageSourceFromChangeData(
  data: FlyChangeData,
  slot: 'primary' | 'dropper',
  userFlies: Fly[],
  catalog: FlyCatalog[],
): ImageSourcePropType | null {
  if (slot === 'dropper') {
    const pattern = data.pattern2 ?? '';
    return resolveFlyImageSource(
      pattern,
      data.size2 ?? null,
      data.color2 ?? null,
      data.user_fly_box_id2 ?? null,
      data.fly_id2 ?? null,
      userFlies,
      catalog,
      data.photo_url2,
    );
  }
  return resolveFlyImageSource(
    data.pattern,
    data.size ?? null,
    data.color ?? null,
    data.user_fly_box_id ?? null,
    data.fly_id ?? null,
    userFlies,
    catalog,
    data.photo_url,
  );
}

export function resolveFlyPhotoUrlFromChangeData(
  data: FlyChangeData,
  slot: 'primary' | 'dropper',
  userFlies: Fly[],
  catalog: FlyCatalog[],
): string | null {
  if (slot === 'dropper') {
    const pattern = data.pattern2 ?? '';
    return resolveFlyPhotoUrl(
      pattern,
      data.size2 ?? null,
      data.color2 ?? null,
      data.user_fly_box_id2 ?? null,
      data.fly_id2 ?? null,
      userFlies,
      catalog,
      data.photo_url2,
    );
  }
  return resolveFlyPhotoUrl(
    data.pattern,
    data.size ?? null,
    data.color ?? null,
    data.user_fly_box_id ?? null,
    data.fly_id ?? null,
    userFlies,
    catalog,
    data.photo_url,
  );
}

export function flyToFlyChangeData(fly: Fly, userFlies?: Fly[], catalog?: FlyCatalog[]): FlyChangeData {
  const photoUrl =
    fly.photo_url?.trim() ??
    resolveFlyPhotoUrl(
      fly.name,
      fly.size ?? null,
      fly.color ?? null,
      fly.id,
      fly.fly_id ?? null,
      userFlies ?? [fly],
      catalog ?? [],
    );
  return {
    pattern: fly.name,
    size: fly.size ?? null,
    color: fly.color ?? null,
    fly_id: fly.fly_id ?? undefined,
    fly_color_id: fly.fly_color_id ?? undefined,
    fly_size_id: fly.fly_size_id ?? undefined,
    user_fly_box_id: fly.id,
    photo_url: photoUrl,
  };
}
