import type { ImageSourcePropType } from 'react-native';

/** Bundled catalog fly photos keyed by normalized pattern name. */
const FLY_IMAGES_BY_NAME: Record<string, ImageSourcePropType> = {
  adams: require('@/assets/images/flies/adams.png'),
  'adams wulff': require('@/assets/images/flies/adams-wulff.png'),
  ant: require('@/assets/images/flies/ant.png'),
  beetle: require('@/assets/images/flies/beetle.png'),
  'blue quill': require('@/assets/images/flies/blue-quill.png'),
  'blue wing olive': require('@/assets/images/flies/blue-wing-olive.png'),
  'brown drake': require('@/assets/images/flies/brown-drake.png'),
  'chernobyl ant': require('@/assets/images/flies/chernobyl-ant.png'),
  'chubby chernobyl': require('@/assets/images/flies/chubby-chernobyl.png'),
  comparadun: require('@/assets/images/flies/comparadun.png'),
  'cripple bwo': require('@/assets/images/flies/cripple-bwo.png'),
  'dave\'s hopper': require('@/assets/images/flies/daves-hopper.png'),
  'elk hair caddis': require('@/assets/images/flies/elk-hair-caddis.png'),
  'flying ant': require('@/assets/images/flies/flying-ant.png'),
  'goddard caddis': require('@/assets/images/flies/goddard-caddis.png'),
  'gray drake': require('@/assets/images/flies/gray-drake.png'),
  'green drake': require('@/assets/images/flies/green-drake.png'),
  'griffiths gnat': require('@/assets/images/flies/griffiths-gnat.png'),
  'h&l variant': require('@/assets/images/flies/h-and-l-variant.png'),
  hendrickson: require('@/assets/images/flies/hendrickson.png'),
  'henryville special': require('@/assets/images/flies/henryville-special.png'),
  'hippie stomper': require('@/assets/images/flies/hippie-stomper.png'),
  humpy: require('@/assets/images/flies/humpy.png'),
  'joe\'s hopper': require('@/assets/images/flies/joes-hopper.png'),
  'kamikaze salmonfly': require('@/assets/images/flies/kamikaze-salmonfly.png'),
  'light cahill': require('@/assets/images/flies/light-cahill.png'),
  'march brown': require('@/assets/images/flies/march-brown.png'),
  'morrish hopper': require('@/assets/images/flies/morrish-hopper.png'),
  'no hackle dry': require('@/assets/images/flies/no-hackle-dry.png'),
  'orange stimulator': require('@/assets/images/flies/orange-stimulator.png'),
  'pale morning dun': require('@/assets/images/flies/pale-morning-dun.png'),
  'parachute adams': require('@/assets/images/flies/parachute-adams.png'),
  'parachute ant': require('@/assets/images/flies/parachute-ant.png'),
  'parachute hopper': require('@/assets/images/flies/parachute-hopper.png'),
  'red quill': require('@/assets/images/flies/red-quill.png'),
  renegade: require('@/assets/images/flies/renegade.png'),
  'royal coachman': require('@/assets/images/flies/royal-coachman.png'),
  'royal trude': require('@/assets/images/flies/royal-trude.png'),
  'royal wulff': require('@/assets/images/flies/royal-wulff.png'),
  'sparkle dun': require('@/assets/images/flies/sparkle-dun.png'),
  stimulator: require('@/assets/images/flies/stimulator.png'),
  trico: require('@/assets/images/flies/trico.png'),
  trude: require('@/assets/images/flies/trude.png'),
  'white wulff': require('@/assets/images/flies/white-wulff.png'),
  'x-caddis': require('@/assets/images/flies/x-caddis.png'),
  'yellow sally': require('@/assets/images/flies/yellow-sally.png'),
  'zebra midge': require('@/assets/images/flies/zebra-midge.png'),
};

function normalizeFlyName(name: string): string {
  return name.trim().toLowerCase();
}

export function getBundledFlyImageSource(name: string | null | undefined): ImageSourcePropType | null {
  if (!name?.trim()) return null;
  return FLY_IMAGES_BY_NAME[normalizeFlyName(name)] ?? null;
}

export const BUNDLED_FLY_IMAGE_NAMES = Object.keys(FLY_IMAGES_BY_NAME).map(
  (k) => k.replace(/\b\w/g, (c) => c.toUpperCase()),
);
