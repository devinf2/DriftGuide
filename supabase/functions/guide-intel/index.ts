import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
/** Custom Edge secrets cannot use the `SUPABASE_` prefix; use `SERVICE_ROLE_KEY` in the dashboard if needed. */
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
const AI_MODEL = "gpt-4o-mini";
/** Chat uses search-backed model so sparse in-app logs can be supplemented with recent public fishing intel. */
const GUIDE_CHAT_MODEL = "gpt-4o-mini-search-preview";
const MAX_REQUESTS_PER_DAY = 400;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function openaiChat(
  system: string,
  user: string,
  maxTokens: number,
  temperature: number,
  model = AI_MODEL,
): Promise<string> {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not configured");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("OpenAI error", data);
    throw new Error(data?.error?.message || "OpenAI request failed");
  }
  return String(data?.choices?.[0]?.message?.content ?? "").trim();
}

type GuideChatSource = { url: string; title: string; fetchedAt: string; excerpt: string };

const DRIFTGUIDE_LOCATION_FENCE = /```\s*driftguide-location\s*([\s\S]*?)```/i;
const UUID_LOC_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stripDriftguideLocationFence(raw: string): { text: string; body: string | null } {
  const m = raw.match(DRIFTGUIDE_LOCATION_FENCE);
  if (!m) return { text: raw.trim(), body: null };
  return { text: raw.replace(DRIFTGUIDE_LOCATION_FENCE, "").trim(), body: m[1].trim() };
}

function asStringArr(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, max)
    .map((x) => String(x ?? "").trim())
    .filter((s) => s.length > 0);
}

/** Validated shape for app UI; null if none or invalid. */
function parseValidatedLocationRecommendation(
  parsed: Record<string, unknown>,
): Record<string, unknown> | null {
  const type = typeof parsed.type === "string" ? parsed.type.trim() : "";
  if (type === "none") return null;
  if (type !== "location_recommendation") return null;
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  if (!summary) return null;
  if (!Array.isArray(parsed.locations) || parsed.locations.length === 0) return null;
  const locations: Record<string, unknown>[] = [];
  for (const item of parsed.locations.slice(0, 6)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const location_id = typeof row.location_id === "string" ? row.location_id.trim() : "";
    const reason = typeof row.reason === "string" ? row.reason.trim() : "";
    if (!name || !location_id || !reason) continue;
    if (!UUID_LOC_RE.test(location_id)) continue;
    let confidence = Number(row.confidence);
    if (!Number.isFinite(confidence)) confidence = 5;
    confidence = Math.max(0, Math.min(10, confidence));
    locations.push({
      name,
      location_id,
      reason,
      top_flies: asStringArr(row.top_flies, 6),
      confidence,
    });
  }
  if (locations.length === 0) return null;
  return { type: "location_recommendation", locations, summary };
}

function parseResponsesGuideOutput(data: Record<string, unknown>): { text: string; sources: GuideChatSource[] } {
  const fetchedAt = new Date().toISOString();
  const byUrl = new Map<string, GuideChatSource>();
  const add = (url: string, title?: string, excerpt = "") => {
    if (!url || byUrl.has(url)) return;
    byUrl.set(url, { url, title: title || url, fetchedAt, excerpt });
  };

  const topText = typeof data.output_text === "string" ? data.output_text.trim() : "";
  const output = data.output;
  if (!Array.isArray(output)) {
    return { text: topText, sources: [...byUrl.values()].slice(0, 14) };
  }

  let text = "";
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.type === "message" && o.role === "assistant") {
      const content = o.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (p.type === "output_text" && typeof p.text === "string") text += p.text;
        const anns = p.annotations;
        if (Array.isArray(anns)) {
          for (const a of anns) {
            if (!a || typeof a !== "object") continue;
            const ann = a as Record<string, unknown>;
            if (ann.type === "url_citation" && typeof ann.url === "string") {
              add(ann.url, typeof ann.title === "string" ? ann.title : undefined);
            }
          }
        }
      }
    }
    if (o.type === "web_search_call") {
      const action = o.action;
      if (action && typeof action === "object") {
        const act = action as Record<string, unknown>;
        const srcList = act.sources;
        if (Array.isArray(srcList)) {
          for (const s of srcList) {
            if (!s || typeof s !== "object") continue;
            const src = s as Record<string, unknown>;
            if (typeof src.url === "string") {
              add(src.url, typeof src.title === "string" ? src.title : undefined);
            }
          }
        }
      }
    }
  }
  const out = text.trim() || topText;
  return { text: out, sources: [...byUrl.values()].slice(0, 14) };
}

/**
 * Responses API + built-in web search: returns answer text and deduped sources when search ran.
 * `sparseData` → tool_choice required so thin in-app signal still triggers a search.
 */
async function openaiResponsesGuideChat(
  system: string,
  user: string,
  opts: { sparseData: boolean; regionLabel: string },
): Promise<{ text: string; sources: GuideChatSource[] }> {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not configured");

  const rl = opts.regionLabel.trim();
  const userLoc =
    rl.length > 0 && rl.length < 80
      ? { type: "approximate" as const, country: "US", region: rl }
      : undefined;

  const buildPayload = (toolType: "web_search" | "web_search_preview"): Record<string, unknown> => {
    const tool: Record<string, unknown> = { type: toolType };
    if (userLoc) tool.user_location = userLoc;
    return {
      model: "gpt-4o-mini",
      tools: [tool],
      tool_choice: opts.sparseData ? "required" : "auto",
      include: ["web_search_call.action.sources"],
      max_output_tokens: 700,
      input: [
        { role: "developer", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: user }] },
      ],
    };
  };

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      console.error("OpenAI responses error", data);
      throw new Error(String((data?.error as { message?: string })?.message ?? "OpenAI responses failed"));
    }
    return parseResponsesGuideOutput(data);
  };

  try {
    return await post(buildPayload("web_search"));
  } catch (e) {
    console.warn("Responses web_search failed, retrying web_search_preview", e);
    return await post(buildPayload("web_search_preview"));
  }
}

async function fetchUsgsSnippet(siteId: string): Promise<{ text: string; url: string }> {
  const url =
    `https://waterservices.usgs.gov/nwis/iv/?sites=${encodeURIComponent(siteId)}` +
    "&parameterCd=00060,00010&siteStatus=all&format=json";
  try {
    const r = await fetch(url, { headers: { "User-Agent": "DriftGuide/1.0 (guide-intel)" } });
    if (!r.ok) return { text: "", url: `https://waterdata.usgs.gov/monitoring-location/${siteId}/` };
    const j = await r.json();
    const series = j?.value?.timeSeries ?? [];
    const parts: string[] = [];
    for (const ts of series.slice(0, 4)) {
      const name = ts?.variable?.variableName ?? "measurement";
      const vals = ts?.values?.[0]?.value ?? [];
      const last = vals[vals.length - 1];
      if (last?.value != null) {
        parts.push(`${name}: ${last.value} at ${last.dateTime ?? "recent"}`);
      }
    }
    const text = parts.length ? `USGS site ${siteId}: ${parts.join("; ")}` : "";
    return { text, url: `https://waterdata.usgs.gov/monitoring-location/${siteId}/` };
  } catch {
    return { text: "", url: `https://waterdata.usgs.gov/monitoring-location/${siteId}/` };
  }
}

/** Atomically increment daily count; returns new count. Fails open if service role missing. */
async function incrementUsage(userId: string): Promise<{ ok: boolean; count: number }> {
  if (!SERVICE_ROLE_KEY) return { ok: true, count: 0 };
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const day = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin.rpc("guide_intel_increment_usage", {
    p_user: userId,
    p_day: day,
  });
  if (error) {
    console.warn("guide_intel_increment_usage", error.message);
    return { ok: true, count: 0 };
  }
  const count = typeof data === "number" ? data : Number(data);
  return { ok: count <= MAX_REQUESTS_PER_DAY, count };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization", code: "unauthorized" }, 401);
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ error: "Invalid session", code: "unauthorized" }, 401);
    }

    const rate = await incrementUsage(user.id);
    if (!rate.ok) {
      return jsonResponse({ error: "Daily guide limit reached", code: "rate_limit" }, 429);
    }

    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const regionLabel = String(body.regionLabel || "this region");

    const guideSystem = (extra: string) =>
      `You are an expert fly fishing guide for ${regionLabel}. ${extra} Prefer .gov and official sources when citing conditions; do not invent forum posts.`;

    if (action === "chat") {
      const question = String(body.question ?? "");
      const contextLines = Array.isArray(body.contextLines) ? body.contextLines.map(String) : [];
      const internalNote = String(body.internalCatchNote ?? "");
      const tierRaw = String(body.chatDataTier ?? "rich").toLowerCase();
      const sparseData = tierRaw === "sparse";
      const includeLocationRecommendationJson = Boolean(body.includeLocationRecommendationJson);

      const sys =
        guideSystem(
          [
            "You have live web search. RECENCY: Prioritize pages and posts from roughly the last 2 weeks when possible; say if intel is older. Forums, Reddit threads, Facebook groups, fly-shop trip reports, and local angler blogs are valid—cite via the model's citations when present.",
            sparseData
              ? "This angler has little or no in-app history for this area—run web search and lean heavily on fresh public reports, shop pages, and agency/stocking news. Do not apologize for thin app data."
              : "Use web search when recent public reports would materially help (unknown water, how's the fishing, thin in-app signal).",
            "VOICE (mandatory): Sound like a helpful guide. Do NOT lead with or emphasize 'no data', 'zero fish logged', 'nothing in the database', or 'not listed in our app'. Treat in-app catch counts as a quiet extra signal; if unhelpful, skip them and answer from conditions + web findings.",
            'CATALOG WATERS: Lines with [catalog_id=UUID] are in-app tap targets. Every time you recommend or name such a water, you MUST include its tag in the sentence: <<spot:that-UUID:Exact catalog title>> — same spelling as the title before [catalog_id=] on that line. FORBIDDEN for catalog names: straight \' or " quotes, curly quotes, or bold+quotes—the app only links <<spot:...>>, not quoted prose. Never invent a UUID.',
            "PARENT → CHILD: When child catalog rows appear under a parent reservoir/river/lake the angler named and they ask where to go, recommend several distinct named children using <<spot:childUUID:exact child line title>>—not generic shore/bank advice and not only the parent row when multiple children are listed. Use activity ordering as a private signal; stay qualitative with the angler.",
            "APP COUNTS: Never quote community/user catch totals, time-bucket counts, or any numbers from the DriftGuide database block to the angler. Use that data only to rank or compare in plain language (e.g. more vs less reported activity)—no digits.",
            "NON-CATALOG WATERS: Normal prose only—no <<spot:...>>. Ground tips in web search when possible.",
            "If 'Location extract → catalog' appears, only <<spot:...>> IDs from those matched lines—never guess.",
            "Prefer .gov, state DWR pages, and reputable shops/outfitters alongside forums; summarize in your own words.",
          ].join(" "),
        );
      const userMsg = [
        ...contextLines,
        internalNote ? `\n${internalNote}` : "",
        "",
        `Angler's question: ${question}`,
        "",
        "Answer in up to 5 short sentences when comparing or recommending waters; otherwise 2–4. Open with actionable fishing advice (techniques, timing, water type)—not with app database disclaimers.",
        "",
        "If you name any water from a line with [catalog_id=...] above, that sentence must contain <<spot:that-uuid:exact title>> — not a quoted, bold-quoted, or apostrophe-wrapped name.",
        "If Parent → child lines or 'Choosing among access points' lists multiple children under a parent they named, cite multiple child <<spot:...>> (2–4 typical)—not a single parent tag only.",
        includeLocationRecommendationJson
          ? [
              "",
              "STRUCTURED APPEND (mandatory): After your prose, output exactly one fenced block and nothing after it:",
              "```driftguide-location",
              '{"type":"location_recommendation"|"none",...}',
              "```",
              'Use {"type":"none"} if the question is not about choosing/ranking/comparing catalog waters from the prompt.',
              'Otherwise {"type":"location_recommendation","summary":"one headline","locations":[{ "name","location_id","reason","top_flies":[],"confidence":0-10 }]} — up to 5 entries, UUIDs from [catalog_id=] only, ordered best first; no raw fish counts in reason. If several child rows exist under a parent they asked about, use 2–5 child entries—not one parent-only row.',
            ].join("\n")
          : "",
      ].join("\n");

      const fetchedAt = new Date().toISOString();
      let text = "";
      let sources: GuideChatSource[] = [];

      try {
        const r = await openaiResponsesGuideChat(sys, userMsg, { sparseData, regionLabel });
        text = r.text;
        sources = r.sources;
      } catch (e) {
        console.warn("guide chat Responses API failed, falling back to Chat Completions", e);
      }

      if (!text) {
        try {
          text = await openaiChat(sys, userMsg, 450, 0.65, GUIDE_CHAT_MODEL);
        } catch (e) {
          console.warn("guide chat search model failed, falling back to standard model", e);
          text = await openaiChat(sys, userMsg, 400, 0.65, AI_MODEL);
        }
      }

      const { text: prose, body: fenceBody } = stripDriftguideLocationFence(text);
      text = prose;
      let locationRecommendation: Record<string, unknown> | undefined;
      if (fenceBody) {
        try {
          const raw = JSON.parse(fenceBody) as Record<string, unknown>;
          const v = parseValidatedLocationRecommendation(raw);
          if (v) locationRecommendation = v;
        } catch {
          /* ignore malformed fence */
        }
      }

      return jsonResponse({
        text,
        sources,
        fetchedAt,
        ...(locationRecommendation ? { locationRecommendation } : {}),
      });
    }

    if (action === "fly_recommendation") {
      const promptUser = String(body.promptUser ?? "");
      const text = await openaiChat(
        guideSystem(
          "Respond with ONLY valid JSON for fly recommendation. Recommend the best fly or two-fly rig for conditions and the trip — the angler's box is context only, not a limit. If the best pattern is not in their box, recommend it anyway and note that briefly in reason.",
        ),
        promptUser,
        280,
        0.6,
      );
      return jsonResponse({ raw: text });
    }

    if (action === "hot_spots") {
      const spots = (body.spots as Record<string, unknown>[]) ?? [];
      const contextDateIso = String(body.contextDateIso ?? new Date().toISOString());
      const forPlannedTrip = Boolean(body.forPlannedTrip);
      const ref = new Date(contextDateIso);
      const lines = spots.map((s) => {
        const p = [`- ${s.name}:`];
        if (s.omitWeather) {
          /* skip wx */
        } else {
          if (s.sky) p.push(String(s.sky));
          if (s.tempF != null) p.push(`${s.tempF}°F`);
          if (s.windMph != null) p.push(`Wind ${s.windMph}mph${s.windDir ? " " + s.windDir : ""}`);
        }
        if (s.flowCfs != null) p.push(`Flow ${s.flowCfs} CFS`);
        if (s.clarity) p.push(`Water ${s.clarity}`);
        if (s.communityFishN != null) p.push(`DriftGuide community logs (60d fish-equivalent): ${s.communityFishN}`);
        return p.join(", ");
      });
      const intro = forPlannedTrip
        ? `You are an expert fishing guide for ${regionLabel}. Based on the planned date, season, time of day, and forecast (or current) weather plus water flow/clarity below, recommend the top 3 places to fish for that trip.`
        : `You are an expert fishing guide for ${regionLabel}. Based on the current season, time of day, and REAL-TIME weather/water conditions below, recommend the top 3 places to fish right now.`;
      const userMsg = [
        intro,
        "",
        `Season/month context: ${ref.toLocaleDateString()}`,
        "",
        "Locations with conditions and optional DriftGuide log counts:",
        ...lines,
        "",
        "IMPORTANT: Penalize rain, thunderstorms, snow, severe weather. Prefer manageable wind and reasonable flows.",
        "When communityFishN is 0 or small, do not claim a location is 'on fire' from app data alone.",
        "",
        'Respond with ONLY valid JSON array: [{"locationName":"...","reason":"...","confidence":0.85}]',
        "Exactly 3 entries, highest confidence first.",
      ].join("\n");
      const raw = await openaiChat(
        guideSystem("Respond with ONLY valid JSON array."),
        userMsg,
        450,
        0.65,
      );
      return jsonResponse({ raw });
    }

    if (action === "spot_summary") {
      const locationName = String(body.locationName ?? "");
      const conditionsSummary = String(body.conditionsSummary ?? "");
      const season = String(body.season ?? "");
      const timeOfDay = String(body.timeOfDay ?? "");
      const usgsSiteId = body.usgsSiteId != null ? String(body.usgsSiteId) : "";
      let external = "";
      let usgsUrl = "https://waterdata.usgs.gov/";
      if (usgsSiteId) {
        const u = await fetchUsgsSnippet(usgsSiteId);
        external = u.text;
        usgsUrl = u.url;
      }
      const n = body.communityFishN != null ? Number(body.communityFishN) : null;
      const nNote = n != null && Number.isFinite(n)
        ? `DriftGuide community fish-equivalent logged (60d) at this water: N=${Math.floor(n)}. If N<=3, treat as anecdotal.`
        : "";
      const userMsg = [
        `Location: ${locationName} (${regionLabel})`,
        `Season: ${season}, Time: ${timeOfDay}`,
        `Current conditions: ${conditionsSummary}`,
        nNote,
        external ? `\nReliable gauge data:\n${external}\n` : "",
        "",
        "Respond with ONLY valid JSON:",
        '{"report":"2-4 sentences","topFlies":["6 flies"],"bestTime":"short window","fishingQualitySignal":0.65,"sources":[{"url":"...","title":"...","fetchedAt":"ISO","excerpt":"..."}]}',
        "fishingQualitySignal: null if you cannot ground in gauge/conditions; else 0-1.",
        usgsSiteId
          ? `Include USGS flow in sources when you use it; use url starting with https://waterdata.usgs.gov/ or the monitoring URL.`
          : "sources can include condition-based reasoning with title 'Local conditions' and url 'https://www.weather.gov/' only if no USGS.",
      ].join("\n");
      const raw = await openaiChat(
        guideSystem(
          "Respond with ONLY valid JSON. Ground fishingQualitySignal in cited data only.",
        ),
        userMsg,
        400,
        0.55,
      );
      return jsonResponse({ raw, fetchedAt: new Date().toISOString(), usgsUrl });
    }

    if (action === "hatch_briefing") {
      const waters = (body.waters as { name: string; conditionsLine: string }[]) ?? [];
      const contextDateIso = String(body.contextDateIso ?? new Date().toISOString());
      const ref = new Date(contextDateIso);
      const lines = waters.map((w) => `- ${w.name}: ${w.conditionsLine}`);
      const userMsg = [
        `You are an expert fly fishing guide for ${regionLabel} and similar mountain/western fisheries.`,
        `Date context: ${ref.toISOString()}`,
        "Waters:",
        ...lines,
        "",
        'Respond ONLY JSON: {"rows":[{"insect":"...","sizes":"#18-20","status":"Active","tier":"active"}]}',
        "2-4 rows. tier: active|starting|waning|other",
      ].join("\n");
      const raw = await openaiChat(
        guideSystem("Respond with ONLY valid JSON."),
        userMsg,
        360,
        0.55,
      );
      return jsonResponse({ raw });
    }

    if (action === "spot_detailed" || action === "guide_greeting" || action === "how_to_fish") {
      const locationName = String(body.locationName ?? "");
      const conditionsSummary = String(body.conditionsSummary ?? "");
      const season = String(body.season ?? "");
      const timeOfDay = String(body.timeOfDay ?? "");
      let sys = "";
      let userMsg = "";
      if (action === "spot_detailed") {
        sys = guideSystem("Write 3-5 short paragraphs. Plain text only, no JSON.");
        userMsg = [
          `Location: ${locationName}`,
          `Season: ${season}, Time: ${timeOfDay}`,
          `Conditions: ${conditionsSummary}`,
          "Cover conditions, where to focus, techniques, best windows, brief safety.",
        ].join("\n");
        const text = await openaiChat(sys, userMsg, 700, 0.6);
        return jsonResponse({ text });
      }
      if (action === "guide_greeting") {
        sys = guideSystem("One short conversational greeting paragraph. No JSON.");
        userMsg = [
          `Location: ${locationName}`,
          `Season: ${season}, Time: ${timeOfDay}`,
          `Conditions: ${conditionsSummary}`,
        ].join("\n");
        const text = await openaiChat(sys, userMsg, 320, 0.6);
        return jsonResponse({ text });
      }
      sys = guideSystem("2-4 sentences, actionable. Plain text.");
      userMsg = [
        `Location: ${locationName}`,
        `Season: ${season}, Time: ${timeOfDay}`,
        `Conditions: ${conditionsSummary}`,
      ].join("\n");
      const text = await openaiChat(sys, userMsg, 220, 0.6);
      return jsonResponse({ text });
    }

    if (action === "fly_of_the_day") {
      const promptUser = String(body.promptUser ?? "");
      const raw = await openaiChat(
        guideSystem(
          "Respond with ONLY valid JSON for one fly. Prefer the angler's fly box when it fits conditions; otherwise recommend the best fly anyway.",
        ),
        promptUser,
        180,
        0.6,
      );
      return jsonResponse({ raw });
    }

    if (action === "extract_locations") {
      const question = String(body.question ?? "").trim();
      if (!question) {
        return jsonResponse({ mentions: [] });
      }
      const sys = [
        "You extract fishing location names the user actually refers to as places to fish (rivers, lakes, reservoirs, named sections).",
        "Do not invent places. Do not add generic regions like 'the mountains' unless it is a proper place name in the message.",
        `Optional context: angler is in or asking about ${regionLabel}.`,
        'Return ONLY valid JSON, no markdown:',
        '{"mentions":[{"name":"string","type":"river"|"lake"|"section"|"reservoir"|"stream"|"unknown"}]}',
        "type = best guess or unknown. If no place names: {\"mentions\":[]}",
        "Examples: 'middle Provo or Strawberry' → two mentions. 'how do I tie a clinch knot' → [].",
      ].join("\n");
      const raw = await openaiChat(sys, question, 220, 0.15);
      let mentions: { name: string; type: string }[] = [];
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { mentions?: unknown };
          if (Array.isArray(parsed.mentions)) {
            for (const m of parsed.mentions.slice(0, 12)) {
              if (!m || typeof m !== "object") continue;
              const o = m as Record<string, unknown>;
              const name = typeof o.name === "string" ? o.name.trim() : "";
              if (name.length < 2) continue;
              const type = typeof o.type === "string" ? o.type : "unknown";
              mentions.push({ name, type });
            }
          }
        }
      } catch (e) {
        console.warn("extract_locations parse", e);
      }
      return jsonResponse({ mentions });
    }

    return jsonResponse({ error: "Unknown action", code: "bad_request" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(e);
    return jsonResponse({ error: msg, code: "internal" }, 500);
  }
});
