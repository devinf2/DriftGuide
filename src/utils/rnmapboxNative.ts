import { NativeModules } from 'react-native';

/** True when @rnmapbox/maps native module is linked (dev client / prebuild), not Expo Go. */
export function isRnMapboxNativeLinked(): boolean {
  return NativeModules.RNMBXModule != null;
}
