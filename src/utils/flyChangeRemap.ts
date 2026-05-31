import type { Fly, FlyChangeData } from '@/src/types';

export type FlyBoxRemapEntry = {
  serverFly: Fly;
  localPhotoUri?: string | null;
};

/** Rewrite fly_change box IDs and local photo snapshots after pending fly sync. */
export function remapFlyChangeDataBoxIds(
  data: FlyChangeData,
  idMap: Map<string, FlyBoxRemapEntry>,
): FlyChangeData {
  const remapSlot = (
    boxId: string | null | undefined,
    photoUrl: string | null | undefined,
  ): { boxId: string | null | undefined; photoUrl: string | null | undefined } => {
    if (!boxId || !idMap.has(boxId)) {
      return { boxId, photoUrl };
    }
    const entry = idMap.get(boxId)!;
    const { serverFly, localPhotoUri } = entry;
    let nextPhoto = photoUrl;
    if (localPhotoUri && photoUrl === localPhotoUri) {
      nextPhoto = serverFly.photo_url ?? photoUrl;
    } else if (!photoUrl && serverFly.photo_url) {
      nextPhoto = serverFly.photo_url;
    }
    return {
      boxId: serverFly.id,
      photoUrl: nextPhoto ?? null,
    };
  };

  const primary = remapSlot(data.user_fly_box_id, data.photo_url);
  const dropper = remapSlot(data.user_fly_box_id2, data.photo_url2);

  return {
    ...data,
    user_fly_box_id: primary.boxId ?? data.user_fly_box_id,
    photo_url: primary.photoUrl ?? data.photo_url,
    user_fly_box_id2: dropper.boxId ?? data.user_fly_box_id2,
    photo_url2: dropper.photoUrl ?? data.photo_url2,
  };
}

export function remapTripEventsFlyBoxIds(
  events: import('@/src/types').TripEvent[],
  idMap: Map<string, FlyBoxRemapEntry>,
): import('@/src/types').TripEvent[] {
  if (idMap.size === 0) return events;
  return events.map((e) => {
    if (e.event_type !== 'fly_change') return e;
    return {
      ...e,
      data: remapFlyChangeDataBoxIds(e.data as FlyChangeData, idMap),
    };
  });
}
