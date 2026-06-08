/// <reference path="../global.d.ts" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

/**
 * Mapbox Vector Tile endpoint for the Utah land overlay.
 *
 *   GET /land-tiles/{z}/{x}/{y}            → land_ownership MVT  (source-layer "land_ownership")
 *   GET /land-tiles/{z}/{x}/{y}?layer=parcels → land_parcels MVT (z16+, source-layer "land_parcels")
 *
 * Returns application/x-protobuf (or 204 for an empty tile). Calls the ST_AsMVT SQL
 * functions over a direct Postgres connection so the bytea comes back as raw bytes
 * (PostgREST/rpc would hex-encode it). SUPABASE_DB_URL is injected by the platform.
 */

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Reuse a small pool across invocations (module scope persists between warm requests).
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, {
  prepare: false,
  max: 3,
  idle_timeout: 20,
});

/** Pull trailing /{z}/{x}/{y} (with optional .pbf/.mvt) from the request path. */
function parseTileCoords(pathname: string): { z: number; x: number; y: number } | null {
  const cleaned = pathname.replace(/\.(pbf|mvt)$/i, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 3) return null;
  const [z, x, y] = parts.slice(-3).map((n) => Number.parseInt(n, 10));
  if (![z, x, y].every(Number.isInteger)) return null;
  if (z < 0 || z > 24 || x < 0 || y < 0) return null;
  return { z, x, y };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const coords = parseTileCoords(url.pathname);
  if (!coords) {
    return new Response("Bad tile request", { status: 400, headers: corsHeaders });
  }
  const { z, x, y } = coords;
  const layer = url.searchParams.get("layer") === "parcels" ? "parcels" : "ownership";

  try {
    const rows =
      layer === "parcels"
        ? await sql`select public.land_parcels_mvt(${z}, ${x}, ${y}) as tile`
        : await sql`select public.land_ownership_mvt(${z}, ${x}, ${y}) as tile`;

    const tile = rows[0]?.tile as Uint8Array | null;
    if (!tile || tile.byteLength === 0) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    return new Response(tile, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/x-protobuf",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    console.error("land-tiles error", { z, x, y, layer, err: String(err) });
    return new Response("Tile generation failed", { status: 500, headers: corsHeaders });
  }
});
