import type * as ImagePicker from 'expo-image-picker';

export type PhotoExifMetadata = {
  takenAt: Date | null;
  latitude: number | null;
  longitude: number | null;
};

function rationalToNumber(r: unknown): number {
  if (typeof r === 'number' && Number.isFinite(r)) return r;
  if (r != null && typeof r === 'object') {
    const o = r as { numerator?: number; denominator?: number };
    if (typeof o.numerator === 'number' && typeof o.denominator === 'number' && o.denominator !== 0) {
      return o.numerator / o.denominator;
    }
  }
  return NaN;
}

/** EXIF GPS: array of [deg, min, sec] rationals or numbers. */
function dmsToDecimal(dms: unknown, ref: unknown): number | null {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const d = rationalToNumber(dms[0]);
  const m = rationalToNumber(dms[1]);
  const s = rationalToNumber(dms[2]);
  if (![d, m, s].every((x) => Number.isFinite(x))) return null;
  let dec = Math.abs(d) + m / 60 + s / 3600;
  const r = typeof ref === 'string' ? ref.toUpperCase() : '';
  if (r === 'S' || r === 'W') dec = -dec;
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
    lat = latRaw;
    lon = lonRaw;
  } else if (typeof latRaw === 'string' && typeof lonRaw === 'string') {
    lat = parseFloat(latRaw);
    lon = parseFloat(lonRaw);
    if (!Number.isFinite(lat)) lat = null;
    if (!Number.isFinite(lon)) lon = null;
  } else {
    lat = dmsToDecimal(latRaw as unknown[], latRef);
    lon = dmsToDecimal(lonRaw as unknown[], lonRef);
  }

  if (lat != null && (lat < -90 || lat > 90)) lat = null;
  if (lon != null && (lon < -180 || lon > 180)) lon = null;
  return { lat, lon };
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
  if (!asset?.exif || typeof asset.exif !== 'object') return empty;
  const exif = asset.exif as Record<string, unknown>;
  const takenAt = readTakenAtFromExif(exif);
  const { lat, lon } = readGpsFromExif(exif);
  return {
    takenAt,
    latitude: lat,
    longitude: lon,
  };
}
