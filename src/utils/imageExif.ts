import type * as ImagePicker from 'expo-image-picker';

export type PhotoExifMetadata = {
  takenAt: Date | null;
  latitude: number | null;
  longitude: number | null;
};

function rationalToNumber(r: unknown): number {
  if (typeof r === 'number' && Number.isFinite(r)) return r;
  if (typeof r === 'string') {
    const slash = r.trim().match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (slash) {
      const num = parseFloat(slash[1]);
      const den = parseFloat(slash[2]);
      if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) return num / den;
    }
    const n = parseFloat(r.trim());
    return Number.isFinite(n) ? n : NaN;
  }
  if (r != null && typeof r === 'object') {
    const o = r as { numerator?: number; denominator?: number };
    if (typeof o.numerator === 'number' && typeof o.denominator === 'number' && o.denominator !== 0) {
      return o.numerator / o.denominator;
    }
  }
  return NaN;
}

/** EXIF GPS: array of [deg, min, sec] rationals or numbers. */
/** EXIF refs are often "N"/"S"/"E"/"W" or words like "West" (iOS / expo-image-picker). */
function refStartsWith(ref: unknown, letter: string): boolean {
  if (ref == null) return false;
  const s = String(ref).trim().toUpperCase();
  return s.startsWith(letter.toUpperCase());
}

/** Decimal magnitude from EXIF + ref: platforms often give positive lon/lat and rely on Ref for sign. */
function signedLatitude(decimalMag: number, latRef: unknown): number {
  const mag = Math.abs(decimalMag);
  return refStartsWith(latRef, 'S') ? -mag : mag;
}

function signedLongitude(decimalMag: number, lonRef: unknown): number {
  const mag = Math.abs(decimalMag);
  return refStartsWith(lonRef, 'W') ? -mag : mag;
}

function dmsToDecimal(dms: unknown, ref: unknown): number | null {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const d = rationalToNumber(dms[0]);
  const m = rationalToNumber(dms[1]);
  const s = rationalToNumber(dms[2]);
  if (![d, m, s].every((x) => Number.isFinite(x))) return null;
  let dec = Math.abs(d) + m / 60 + s / 3600;
  if (refStartsWith(ref, 'S') || refStartsWith(ref, 'W')) dec = -dec;
  return dec;
}

/**
 * Parse EXIF DateTimeOriginal / DateTime (format `YYYY:MM:DD HH:mm:ss`).
 * Interpreted as local wall time (device/camera convention when no TZ offset).
 */
export function parseExifDateTimeString(raw: unknown): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const h = parseInt(m[4], 10);
  const mi = parseInt(m[5], 10);
  const sec = parseInt(m[6], 10);
  if ([y, mo, d, h, mi, sec].some((n) => Number.isNaN(n))) return null;
  return new Date(y, mo, d, h, mi, sec);
}

function readGpsFromExif(exif: Record<string, unknown>): { lat: number | null; lon: number | null } {
  const latRaw =
    exif.GPSLatitude ?? exif['{GPS}Latitude'] ?? (exif as { latitude?: number }).latitude;
  const lonRaw =
    exif.GPSLongitude ?? exif['{GPS}Longitude'] ?? (exif as { longitude?: number }).longitude;
  const latRef = exif.GPSLatitudeRef ?? exif['{GPS}LatitudeRef'];
  const lonRef = exif.GPSLongitudeRef ?? exif['{GPS}LongitudeRef'];

  let lat: number | null = null;
  let lon: number | null = null;

  if (typeof latRaw === 'number' && typeof lonRaw === 'number' && Number.isFinite(latRaw) && Number.isFinite(lonRaw)) {
    lat = signedLatitude(latRaw, latRef);
    lon = signedLongitude(lonRaw, lonRef);
  } else if (typeof latRaw === 'string' && typeof lonRaw === 'string') {
    const la = parseFloat(latRaw);
    const lo = parseFloat(lonRaw);
    lat = Number.isFinite(la) ? signedLatitude(la, latRef) : null;
    lon = Number.isFinite(lo) ? signedLongitude(lo, lonRef) : null;
  } else {
    lat = dmsToDecimal(latRaw as unknown[], latRef);
    lon = dmsToDecimal(lonRaw as unknown[], lonRef);
  }

  if (lat != null && (lat < -90 || lat > 90)) lat = null;
  if (lon != null && (lon < -180 || lon > 180)) lon = null;
  return { lat, lon };
}

const LOCATION_KEY_RE = /gps|latitude|longitude|location|position|dest|area|city|country|sublocation|heading|speed|timestamp|hposition|vposition|map/i;

function previewExifValue(v: unknown, depth = 0): unknown {
  if (v == null) return v;
  if (typeof v === 'string') return v.length > 160 ? `${v.slice(0, 157)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth >= 2) return '[nested]';
  if (Array.isArray(v)) {
    if (v.length === 0) return [];
    return { _arrayLen: v.length, _first: previewExifValue(v[0], depth + 1) };
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length > 12) return { _objectKeys: keys.slice(0, 12).join(',') + '…' };
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (LOCATION_KEY_RE.test(k)) out[k] = previewExifValue(o[k], depth + 1);
    }
    return Object.keys(out).length ? out : { _keys: keys.join(',') };
  }
  return String(v);
}

/** For debugging: location-ish keys from flat EXIF and common nested blocks. */
function collectLocationHints(exif: Record<string, unknown>): Record<string, unknown> {
  const hints: Record<string, unknown> = {};
  const scan = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (!LOCATION_KEY_RE.test(k)) continue;
      hints[prefix ? `${prefix}.${k}` : k] = previewExifValue(v);
    }
  };
  scan(exif, '');
  const gps = exif.GPS ?? exif['{GPS}'];
  if (gps && typeof gps === 'object' && !Array.isArray(gps)) {
    scan(gps as Record<string, unknown>, 'GPS');
  }
  const exifBlock = exif.Exif ?? exif['{Exif}'];
  if (exifBlock && typeof exifBlock === 'object' && !Array.isArray(exifBlock)) {
    scan(exifBlock as Record<string, unknown>, 'Exif');
  }
  return hints;
}

function readTakenAtFromExif(exif: Record<string, unknown>): Date | null {
  const candidates = [
    exif.DateTimeOriginal,
    exif.DateTimeDigitized,
    exif.DateTime,
    exif['{Exif}DateTimeOriginal'],
    exif['{Exif}DateTimeDigitized'],
  ];
  for (const c of candidates) {
    const d = parseExifDateTimeString(c);
    if (d && !Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Best-effort EXIF from expo-image-picker asset (`exif: true`).
 * Missing GPS/time is common (messengers strip metadata).
 */
export function extractPhotoMetadataFromPickerAsset(
  asset: ImagePicker.ImagePickerAsset | null | undefined,
): PhotoExifMetadata {
  const empty: PhotoExifMetadata = { takenAt: null, latitude: null, longitude: null };
  if (!asset?.exif || typeof asset.exif !== 'object') {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && asset) {
      console.log('[importExif] no exif object on picker asset', {
        fileName: asset.fileName ?? asset.uri?.split('/').pop(),
        uriPrefix: asset.uri?.slice(0, 72),
      });
    }
    return empty;
  }
  const exif = asset.exif as Record<string, unknown>;
  let takenAt = readTakenAtFromExif(exif);
  let { lat, lon } = readGpsFromExif(exif);
  const gpsNested = exif.GPS ?? exif['{GPS}'];
  if ((lat == null || lon == null) && gpsNested && typeof gpsNested === 'object' && !Array.isArray(gpsNested)) {
    const nested = readGpsFromExif(gpsNested as Record<string, unknown>);
    if (lat == null) lat = nested.lat;
    if (lon == null) lon = nested.lon;
  }
  if (takenAt == null) {
    const exifNested = exif.Exif ?? exif['{Exif}'];
    if (exifNested && typeof exifNested === 'object' && !Array.isArray(exifNested)) {
      takenAt = readTakenAtFromExif(exifNested as Record<string, unknown>);
    }
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const fileName = asset.fileName ?? asset.uri?.split('/').pop() ?? '?';
    const exifKeys = Object.keys(exif);
    console.log('[importExif] parsed', {
      fileName,
      takenAt: takenAt?.toISOString?.() ?? null,
      latitude: lat,
      longitude: lon,
      exifTopLevelKeyCount: exifKeys.length,
      exifTopLevelKeysSample: exifKeys.slice(0, 40),
    });
    if (lat == null || lon == null) {
      const hints = collectLocationHints(exif);
      const latRaw =
        exif.GPSLatitude ?? exif['{GPS}Latitude'] ?? (exif as { latitude?: unknown }).latitude;
      const lonRaw =
        exif.GPSLongitude ?? exif['{GPS}Longitude'] ?? (exif as { longitude?: unknown }).longitude;
      console.log('[importExif] no decimal lat/lon — raw GPS field shapes', {
        fileName,
        latRawType: latRaw === undefined ? 'undefined' : latRaw === null ? 'null' : typeof latRaw,
        lonRawType: lonRaw === undefined ? 'undefined' : lonRaw === null ? 'null' : typeof lonRaw,
        latRawPreview: previewExifValue(latRaw),
        lonRawPreview: previewExifValue(lonRaw),
        locationHints: Object.keys(hints).length ? hints : '(no keys matched location/GPS pattern)',
      });
    }
  }

  return {
    takenAt,
    latitude: lat,
    longitude: lon,
  };
}
