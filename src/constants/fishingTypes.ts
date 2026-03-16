import { FishingType, FlyType, type FlyPresentation } from '@/src/types';

export const FISHING_TYPE_LABELS: Record<FishingType, string> = {
  fly: 'Fly Fishing',
  bait: 'Bait Fishing',
  spin: 'Spin Fishing',
};

export const FLY_TYPE_LABELS: Record<FlyType, string> = {
  fly: 'Fly',
  bait: 'Bait',
  lure: 'Lure',
};

/** Fly fishing presentation: how the fly behaves in the water. */
export const FLY_PRESENTATION_LABELS: Record<FlyPresentation, string> = {
  dry: 'Dry (floats on surface)',
  emerger: 'Emerger (surface film)',
  wet: 'Wet (just below surface)',
  nymph: 'Nymph (subsurface)',
  streamer: 'Streamer (subsurface, stripped)',
};

export const COMMON_SPECIES = [
  'Rainbow Trout',
  'Brown Trout',
  'Brook Trout',
  'Cutthroat Trout',
  'Lake Trout',
  'Largemouth Bass',
  'Smallmouth Bass',
  'Bluegill',
  'Walleye',
  'Northern Pike',
  'Kokanee Salmon',
  'Mountain Whitefish',
  'Channel Catfish',
  'Carp',
  'Other',
];

export interface CommonFly {
  name: string;
  size: number;
  color: string;
  /** How the fly is fished: dry, emerger, wet, nymph, streamer */
  presentation: FlyPresentation;
  /** Optional image URL for key flies (add assets or URLs as needed) */
  imageUrl?: string | null;
}

export const COMMON_FLIES: CommonFly[] = [
  { name: 'Zebra Midge', size: 20, color: 'Black', presentation: 'nymph' },
  { name: 'Pheasant Tail Nymph', size: 16, color: 'Natural', presentation: 'nymph' },
  { name: 'Blue Wing Olive', size: 18, color: 'Olive', presentation: 'dry' },
  { name: 'Elk Hair Caddis', size: 14, color: 'Tan', presentation: 'dry' },
  { name: 'Woolly Bugger', size: 8, color: 'Black', presentation: 'streamer' },
  { name: 'Adams', size: 14, color: 'Gray', presentation: 'dry' },
  { name: 'San Juan Worm', size: 12, color: 'Red', presentation: 'nymph' },
  { name: 'Hares Ear Nymph', size: 14, color: 'Natural', presentation: 'nymph' },
  { name: 'RS2', size: 22, color: 'Gray', presentation: 'emerger' },
  { name: 'Copper John', size: 16, color: 'Copper', presentation: 'nymph' },
  { name: 'Griffiths Gnat', size: 20, color: 'Black', presentation: 'dry' },
  { name: 'Parachute Adams', size: 16, color: 'Gray', presentation: 'dry' },
  { name: 'Stimulator', size: 10, color: 'Yellow', presentation: 'dry' },
  { name: 'Prince Nymph', size: 14, color: 'Dark', presentation: 'nymph' },
  { name: 'Midges (generic)', size: 22, color: 'Black', presentation: 'emerger' },
];

/** Lookup common fly by name for presentation/image when picker uses COMMON_FLIES. */
export const COMMON_FLIES_BY_NAME: Record<string, CommonFly> = Object.fromEntries(
  COMMON_FLIES.map((f) => [f.name, f])
);

export const FLY_NAMES = COMMON_FLIES.map(f => f.name);

export const FLY_SIZES = [8, 10, 12, 14, 16, 18, 20, 22, 24];

export const FLY_COLORS = [
  'Black', 'Natural', 'Olive', 'Tan', 'Gray',
  'Red', 'Copper', 'Yellow', 'Brown', 'White',
  'Dark', 'Chartreuse', 'Orange', 'Purple',
];
