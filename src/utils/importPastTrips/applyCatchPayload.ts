import type { CatchData, FlyChangeData, TripEvent } from '@/src/types';
import type { CatchDetailsSubmitAdd } from '@/src/components/catch/CatchDetailsModal';
import { upsertEventSorted } from '@/src/utils/journalTimeline';
import { normalizeCatchPhotoUrls } from '@/src/utils/catchPhotos';
import { v4 as uuidv4 } from 'uuid';

function flyDataMatches(a: FlyChangeData, b: FlyChangeData): boolean {
  return (
    a.pattern === b.pattern &&
    (a.size ?? null) === (b.size ?? null) &&
    (a.color ?? null) === (b.color ?? null) &&
    (a.pattern2 ?? null) === (b.pattern2 ?? null) &&
    (a.size2 ?? null) === (b.size2 ?? null) &&
    (a.color2 ?? null) === (b.color2 ?? null)
  );
}

function buildFlyPayload(primary: FlyChangeData, dropper: FlyChangeData | null): FlyChangeData {
  const base: FlyChangeData = {
    pattern: primary.pattern,
    size: primary.size ?? null,
    color: primary.color ?? null,
    fly_id: primary.fly_id,
    fly_color_id: primary.fly_color_id,
    fly_size_id: primary.fly_size_id,
  };
  if (dropper?.pattern?.trim()) {
    return {
      ...base,
      pattern2: dropper.pattern,
      size2: dropper.size ?? null,
      color2: dropper.color ?? null,
      fly_id2: dropper.fly_id,
      fly_color_id2: dropper.fly_color_id,
      fly_size_id2: dropper.fly_size_id,
    };
  }
  return base;
}

/**
 * Apply an "add catch" payload to draft import events (no tripStore).
 * Mirrors active-trip fly_change + catch linking when the rig changes.
 */
export function applyCatchDetailsAddPayload(input: {
  tripId: string;
  events: TripEvent[];
  currentFlyEventId: string | null;
  currentPrimary: FlyChangeData | null;
  currentDropper: FlyChangeData | null;
  payload: CatchDetailsSubmitAdd;
}): {
  events: TripEvent[];
  currentFlyEventId: string;
  currentPrimary: FlyChangeData;
  currentDropper: FlyChangeData | null;
  catchEventId: string;
  quantityAdded: number;
} {
  const { tripId, payload } = input;
  let events = [...input.events];
  const { primary, dropper, catchFields, latitude, longitude, photoUris, conditionsSnapshot } = payload;

  const timestamp =
    payload.catchTimestampIso && !Number.isNaN(Date.parse(payload.catchTimestampIso))
      ? payload.catchTimestampIso
      : payload.photoCapturedAtIso && !Number.isNaN(Date.parse(payload.photoCapturedAtIso))
        ? payload.photoCapturedAtIso
        : new Date().toISOString();

  const newFlyPayload = buildFlyPayload(primary, dropper);
  const linkedFly = input.currentFlyEventId
    ? events.find((e) => e.id === input.currentFlyEventId && e.event_type === 'fly_change')
    : null;
  const linkedData = linkedFly ? (linkedFly.data as FlyChangeData) : null;
  const flyUnchanged =
    linkedData != null &&
    input.currentFlyEventId != null &&
    flyDataMatches(linkedData, newFlyPayload);

  let resolvedFlyEventId: string;

  if (!flyUnchanged) {
    const newFlyId = uuidv4();
    const tCatch = new Date(timestamp).getTime();
    const flyTs = new Date(Math.max(0, tCatch - 2)).toISOString();
    const flyEvent: TripEvent = {
      id: newFlyId,
      trip_id: tripId,
      event_type: 'fly_change',
      timestamp: flyTs,
      data: newFlyPayload,
      conditions_snapshot: null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
    };
    events = upsertEventSorted(events, flyEvent);
    resolvedFlyEventId = newFlyId;
  } else {
    resolvedFlyEventId = input.currentFlyEventId as string;
  }

  const qty = Math.max(1, catchFields.quantity ?? 1);
  const eventId = uuidv4();
  const hasPhotos = photoUris.length > 0;
  const photoSeed: CatchData = {
    species: null,
    size_inches: null,
    note: null,
    photo_url: hasPhotos ? photoUris[0] : null,
    photo_urls: hasPhotos ? [...photoUris] : null,
    active_fly_event_id: resolvedFlyEventId,
  };
  const orderedPhotoUrls = normalizeCatchPhotoUrls(photoSeed);

  const catchEvent: TripEvent = {
    id: eventId,
    trip_id: tripId,
    event_type: 'catch',
    timestamp,
    data: {
      species: catchFields.species ?? null,
      size_inches: catchFields.size_inches ?? null,
      weight_lb: catchFields.weight_lb ?? null,
      weight_oz: catchFields.weight_oz ?? null,
      note: catchFields.note ?? null,
      photo_url: orderedPhotoUrls[0] ?? null,
      photo_urls: orderedPhotoUrls.length ? orderedPhotoUrls : null,
      active_fly_event_id: resolvedFlyEventId,
      caught_on_fly: catchFields.caught_on_fly ?? null,
      quantity: qty,
      depth_ft: catchFields.depth_ft ?? null,
      presentation_method: catchFields.presentation_method ?? null,
      released: catchFields.released ?? null,
      structure: catchFields.structure ?? null,
    } as CatchData,
    conditions_snapshot:
      conditionsSnapshot !== undefined ? conditionsSnapshot ?? null : null,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
  };

  events = upsertEventSorted(events, catchEvent);

  return {
    events,
    currentFlyEventId: resolvedFlyEventId,
    currentPrimary: primary,
    currentDropper: dropper ?? null,
    catchEventId: eventId,
    quantityAdded: qty,
  };
}
