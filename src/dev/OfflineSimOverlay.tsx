/**
 * Development builds only. Root layout `require`s this file only inside `if (__DEV__)`.
 * Production/Store builds set `__DEV__ === false`, so this module is not loaded and the
 * simulate-offline UI never ships to users.
 */
import { SimulateOfflineDevButton } from '@/src/components/SimulateOfflineDevButton';

export function OfflineSimOverlay() {
  return <SimulateOfflineDevButton />;
}
