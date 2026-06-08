/**
 * Styling + copy for the "Public / Private Land" map overlay (Utah UGRC data).
 * Colors are intentionally light so they read as a translucent fill over the basemap.
 */
import type { LandOwnershipInfo, LandOwnershipType } from '@/src/types';

/** Fill colors keyed by ownership bucket (spec: private red, federal green, state blue, tribal orange). */
export const LAND_OWNERSHIP_FILL_COLORS: Record<LandOwnershipType, string> = {
  private: '#F4B6B6', // light red
  federal: '#BFE3C0', // light green
  state: '#BBD6F2', // light blue
  tribal: '#F6C68A', // orange
  local: '#D9D2C5', // muted tan
  water: '#C7DDE8', // muted blue
  unknown: '#D5D5D5', // gray
};

/** Slightly darker stroke per bucket for polygon outlines. */
export const LAND_OWNERSHIP_LINE_COLORS: Record<LandOwnershipType, string> = {
  private: '#D98B8B',
  federal: '#8CC58E',
  state: '#86B0DD',
  tribal: '#D99A52',
  local: '#B3AB98',
  water: '#9CBED0',
  unknown: '#AFAFAF',
};

export const LAND_OWNERSHIP_LABELS: Record<LandOwnershipType, string> = {
  private: 'Private land',
  federal: 'Federal public land',
  state: 'State land',
  tribal: 'Tribal land',
  local: 'Local / municipal land',
  water: 'Water / sovereign land',
  unknown: 'Unknown ownership',
};

/** Buckets shown in the map legend (in display order). */
export const LAND_OWNERSHIP_LEGEND: LandOwnershipType[] = [
  'private',
  'federal',
  'state',
  'tribal',
];

export type LandAccessTone = 'public' | 'restricted' | 'unknown';

export interface LandAccessMessage {
  tone: LandAccessTone;
  title: string;
  body: string;
}

/**
 * Human-facing access guidance for the bottom sheet. Derived from `access_status` with
 * ownership-specific nuance (SITLA permits, tribal permissions). Not legal advice — copy
 * is deliberately cautionary.
 */
export function landAccessMessage(info: LandOwnershipInfo): LandAccessMessage {
  if (info.access_status === 'public') {
    return {
      tone: 'public',
      title: 'Open to public access',
      body: 'Generally open for public recreation. Respect posted closures and seasonal restrictions.',
    };
  }
  if (info.access_status === 'restricted') {
    if (info.ownership_type === 'private') {
      return {
        tone: 'restricted',
        title: 'Private — permission required',
        body: 'Access requires the landowner’s permission. Do not enter or cross without it.',
      };
    }
    if (info.ownership_type === 'tribal') {
      return {
        tone: 'restricted',
        title: 'Tribal land — permit required',
        body: 'Access and fishing are governed by the tribe and typically require a tribal permit.',
      };
    }
    if (info.agency?.includes('SITLA')) {
      return {
        tone: 'restricted',
        title: 'State trust land — check requirements',
        body: 'SITLA land may require a permit for recreation. Verify access rules before use.',
      };
    }
    return {
      tone: 'restricted',
      title: 'Restricted access',
      body: 'Access may be limited. Verify the rules with the managing agency before entering.',
    };
  }
  return {
    tone: 'unknown',
    title: 'Access status unknown',
    body: 'Ownership is recorded but public access is not confirmed. Verify before entering.',
  };
}
