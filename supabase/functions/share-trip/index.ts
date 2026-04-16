/// <reference path="../global.d.ts" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

/**
 * Trip share landing page + Open Graph tags for iMessage / Facebook / etc.
 * URL: GET .../functions/v1/share-trip?trip_id=<uuid>
 *
 * Crawlers have no JWT — verify_jwt = false in supabase/config.toml.
 *
 * Default OG image: optional secret SHARE_TRIP_DEFAULT_OG_IMAGE_URL (full https URL).
 * If unset, uses https://driftguide-web.vercel.app/logo.png
 * Universal Links on apple-app-site-association require a domain you control; this host is
 * *.supabase.co — use driftguide://trip/<id> from this page until a static host serves AASA.
 */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PreviewRow = {
  rich_preview: boolean;
  title: string;
  description: string;
  image_url: string | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const tripIdRaw = url.searchParams.get("trip_id")?.trim() ?? "";
  const canonicalUrl = url.toString().split("#")[0];

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const driftguideBrandOgImage = "https://driftguide-web.vercel.app/logo.png";
  const defaultOgFromEnv = Deno.env.get("SHARE_TRIP_DEFAULT_OG_IMAGE_URL")?.trim();
  const defaultOgImage =
    defaultOgFromEnv && defaultOgFromEnv.startsWith("https://")
      ? defaultOgFromEnv
      : driftguideBrandOgImage;

  const appStoreUrl = Deno.env.get("APP_STORE_URL")?.trim() ?? "";
  const playStoreUrl = Deno.env.get("PLAY_STORE_URL")?.trim() ?? "";

  let title = "DriftGuide";
  let description = "Open in the app to see this trip.";
  let imageUrl = defaultOgImage;

  if (UUID_RE.test(tripIdRaw)) {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin.rpc("trip_link_preview", {
      p_trip_id: tripIdRaw,
    });

    if (!error && data && Array.isArray(data) && data.length > 0) {
      const row = data[0] as PreviewRow;
      title = row.title?.trim() || title;
      description = row.description?.trim() || description;
      const candidate = row.image_url?.trim();
      if (candidate && /^https:\/\//i.test(candidate)) {
        imageUrl = candidate;
      } else {
        imageUrl = defaultOgImage;
      }
    }
  }

  const tripLinkValid = UUID_RE.test(tripIdRaw);
  const deepLink = tripLinkValid ? `driftguide://trip/${tripIdRaw}` : "";
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safeOgUrl = escapeAttr(canonicalUrl);
  const safeOgImage = escapeAttr(imageUrl);

  const openAppBlock = tripLinkValid
    ? `<p><a href="${escapeAttr(deepLink)}" style="display:inline-block;padding:0.65rem 1rem;background:#0b5cab;color:#fff;text-decoration:none;border-radius:0.5rem;font-weight:600;">Open in DriftGuide</a></p>`
    : `<p style="color:#64748b;">This link is missing a valid trip id.</p>`;

  const storeBlock = [
    appStoreUrl
      ? `<p><a href="${escapeAttr(appStoreUrl)}">Download on the App Store</a></p>`
      : "",
    playStoreUrl
      ? `<p><a href="${escapeAttr(playStoreUrl)}">Get it on Google Play</a></p>`
      : "",
  ].join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeAttr(title)}" />
  <meta property="og:description" content="${escapeAttr(description)}" />
  <meta property="og:image" content="${safeOgImage}" />
  <meta property="og:url" content="${safeOgUrl}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeAttr(title)}" />
  <meta name="twitter:description" content="${escapeAttr(description)}" />
  <meta name="twitter:image" content="${safeOgImage}" />
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; max-width: 28rem; margin: 2rem auto; padding: 0 1rem; color: #0b1220;">
  <h1 style="font-size: 1.25rem;">${safeTitle}</h1>
  <p style="color: #334155;">${safeDesc}</p>
  ${openAppBlock}
  ${storeBlock}
  <p style="font-size:0.85rem;color:#64748b;margin-top:2rem;">DriftGuide — fishing trips &amp; journal</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
});
