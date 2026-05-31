/** Supabase Storage public object URL → image render/transform URL. */
const SUPABASE_OBJECT_PUBLIC_RE =
  /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/;

/**
 * Return a smaller Supabase Storage render URL for list thumbnails.
 * Non-Supabase and local URIs are returned unchanged.
 */
export function supabasePhotoThumbUrl(
  url: string,
  maxPixelSize: number,
  resize: 'cover' | 'contain' = 'cover',
): string {
  const trimmed = url.trim();
  if (!trimmed.startsWith('http')) return trimmed;
  if (trimmed.includes('/storage/v1/render/image/')) return trimmed;
  if (maxPixelSize <= 0) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const match = parsed.pathname.match(SUPABASE_OBJECT_PUBLIC_RE);
    if (!match) return trimmed;

    const [, bucket, objectPath] = match;
    const size = Math.round(maxPixelSize);
    const render = new URL(
      `/storage/v1/render/image/public/${bucket}/${objectPath}`,
      parsed.origin,
    );
    render.searchParams.set('width', String(size));
    render.searchParams.set('height', String(size));
    render.searchParams.set('resize', resize);
    render.searchParams.set('quality', '75');
    return render.toString();
  } catch {
    return trimmed;
  }
}

/** Layout size (dp) → pixel size for image requests on the current screen. */
export function layoutSizeToPixelSize(layoutDp: number, scale = 1): number {
  return Math.max(1, Math.ceil(layoutDp * scale));
}
