// WS-G — activity-push (scheduled / cron edge function)
//
// Polls unprocessed rows in public.activity_events (built by WS-H, migration
// 117), resolves recipients, pushes to their device_tokens, and stamps
// processed_at so each event is delivered exactly once (idempotent — a row is
// only picked up while processed_at IS NULL).
//
// activity_events columns this function DEPENDS ON (MUST match migration 117):
//   id uuid, type text ('post_created' | 'post_reaction'),
//   actor_id uuid, recipient_id uuid NULL (NULL on 'post_created' => fan out to
//   the actor's accepted friends; set on 'post_reaction' => the post author),
//   post_id uuid, processed_at timestamptz NULL (NULL = not yet pushed; partial
//   index on unprocessed rows), created_at timestamptz.
//
// Recipient resolution mirrors the pure module src/utils/activityRecipients.ts.
// Accepted friends are read from public.friendships (status 'accepted',
// migrations 046/052) with the service role (bypasses RLS).
//
// Deploy: `supabase functions deploy activity-push`. Registered in config.toml
// with verify_jwt = false; authorizes via CRON_SECRET header or service-role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Max events to process per invocation (keeps each run bounded).
const BATCH_SIZE = 200;

interface ActivityEventRow {
  id: string;
  type:
    | "post_created"
    | "post_reaction"
    | "friend_request"
    | "friend_accept"
    | "guide_booking_request"
    | "guide_review"
    | "guide_created"
    | "business_created";
  actor_id: string;
  recipient_id: string | null;
  post_id: string | null;
  entity_id: string | null;
}

interface ResolvedRecipient {
  userId: string;
  title: string;
  body: string;
  data: { type: string; postId: string | null; actorId: string; entityId?: string | null };
}

// Mirror of src/utils/activityRecipients.ts resolveActivityRecipients().
function resolveRecipients(
  event: ActivityEventRow,
  acceptedFriendIds: string[],
  actorName: string,
): ResolvedRecipient[] {
  const name = actorName.trim() || "A friend";
  if (event.type === "post_created") {
    const unique = new Set<string>();
    for (const id of acceptedFriendIds) {
      if (id && id !== event.actor_id) unique.add(id);
    }
    return [...unique].map((userId) => ({
      userId,
      title: "New from your friends",
      body: `${name} shared a new post.`,
      data: { type: event.type, postId: event.post_id, actorId: event.actor_id },
    }));
  }
  // Remaining types are all targeted (recipient_id set; never fanned out).
  if (!event.recipient_id || event.recipient_id === event.actor_id) return [];
  if (event.type === "friend_request") {
    return [
      {
        userId: event.recipient_id,
        title: "New friend request",
        body: `${name} sent you a friend request.`,
        data: { type: event.type, postId: null, actorId: event.actor_id },
      },
    ];
  }
  if (event.type === "friend_accept") {
    return [
      {
        userId: event.recipient_id,
        title: "Friend request accepted",
        body: `${name} accepted your friend request.`,
        data: { type: event.type, postId: null, actorId: event.actor_id },
      },
    ];
  }
  if (event.type === "guide_booking_request") {
    return [
      {
        userId: event.recipient_id,
        title: "New booking request",
        body: `${name} requested to book a trip with you.`,
        data: { type: event.type, postId: null, actorId: event.actor_id },
      },
    ];
  }
  if (event.type === "guide_review") {
    return [
      {
        userId: event.recipient_id,
        title: "New review",
        body: `${name} left you a review.`,
        data: { type: event.type, postId: null, actorId: event.actor_id },
      },
    ];
  }
  if (event.type === "guide_created") {
    // Fanned out at insert time (migration 129) — one targeted row per admin.
    // actor_id is the new guide's profile_id, which the tap routes to /guide/:id.
    return [
      {
        userId: event.recipient_id,
        title: "New guide to review",
        body: `${name} created a guide profile.`,
        data: { type: event.type, postId: null, actorId: event.actor_id },
      },
    ];
  }
  if (event.type === "business_created") {
    // Fanned out at insert time (migration 130) — one targeted row per admin.
    // actor_id is the submitter; entity_id is the business, which the tap routes to.
    return [
      {
        userId: event.recipient_id,
        title: "New shop to review",
        body: `${name} submitted a shop for review.`,
        data: { type: event.type, postId: null, actorId: event.actor_id, entityId: event.entity_id },
      },
    ];
  }
  // post_reaction
  return [
    {
      userId: event.recipient_id,
      title: "Someone liked your post",
      body: `${name} reacted to your post.`,
      data: { type: event.type, postId: event.post_id, actorId: event.actor_id },
    },
  ];
}

async function sendExpoPushes(
  messages: { to: string; title: string; body: string; data: Record<string, unknown> }[],
): Promise<void> {
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(chunk),
      });
    } catch (err) {
      console.warn("[activity-push] expo push failed", err);
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!;
  const CRON_SECRET = Deno.env.get("CRON_SECRET");

  const provided = req.headers.get("x-cron-secret");
  const auth = req.headers.get("authorization") ?? "";
  const isService = auth === `Bearer ${SERVICE_ROLE_KEY}`;
  if (CRON_SECRET && provided !== CRON_SECRET && !isService) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Pull a bounded batch of unprocessed events (partial index on processed_at IS NULL).
  const { data: events, error: evErr } = await admin
    .from("activity_events")
    // Column is event_type; alias to `type` so the row shape matches ActivityEventRow.
    .select("id, type:event_type, actor_id, recipient_id, post_id, entity_id")
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (evErr) {
    return new Response(JSON.stringify({ error: evErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!events || events.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0, pushed: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Cache actor display names + accepted-friend lists across the batch.
  const actorNameCache = new Map<string, string>();
  const friendsCache = new Map<string, string[]>();

  async function getActorName(actorId: string): Promise<string> {
    const cached = actorNameCache.get(actorId);
    if (cached != null) return cached;
    const { data } = await admin
      .from("profiles")
      .select("display_name, first_name, username")
      .eq("id", actorId)
      .maybeSingle();
    const name =
      (data?.display_name?.trim() ||
        data?.first_name?.trim() ||
        data?.username?.trim() ||
        "A friend") ?? "A friend";
    actorNameCache.set(actorId, name);
    return name;
  }

  // Accepted friends from the ordered friendships table (status 'accepted').
  async function getAcceptedFriends(actorId: string): Promise<string[]> {
    const cached = friendsCache.get(actorId);
    if (cached) return cached;
    const { data } = await admin
      .from("friendships")
      .select("profile_min, profile_max, status")
      .eq("status", "accepted")
      .or(`profile_min.eq.${actorId},profile_max.eq.${actorId}`);
    const ids = (data ?? [])
      .map((r: { profile_min: string; profile_max: string }) =>
        r.profile_min === actorId ? r.profile_max : r.profile_min,
      )
      .filter(Boolean);
    friendsCache.set(actorId, ids);
    return ids;
  }

  // Build the recipient set, then map recipients -> their device tokens.
  const allResolved: ResolvedRecipient[] = [];
  for (const ev of events as ActivityEventRow[]) {
    const actorName = await getActorName(ev.actor_id);
    const friends = ev.type === "post_created" ? await getAcceptedFriends(ev.actor_id) : [];
    allResolved.push(...resolveRecipients(ev, friends, actorName));
  }

  const recipientIds = [...new Set(allResolved.map((r) => r.userId))];
  const tokensByUser = new Map<string, string[]>();
  if (recipientIds.length > 0) {
    const { data: tokenRows } = await admin
      .from("device_tokens")
      .select("user_id, expo_push_token")
      .in("user_id", recipientIds);
    for (const row of tokenRows ?? []) {
      const list = tokensByUser.get(row.user_id) ?? [];
      list.push(row.expo_push_token);
      tokensByUser.set(row.user_id, list);
    }
  }

  const messages: { to: string; title: string; body: string; data: Record<string, unknown> }[] = [];
  for (const r of allResolved) {
    for (const token of tokensByUser.get(r.userId) ?? []) {
      messages.push({ to: token, title: r.title, body: r.body, data: r.data });
    }
  }

  if (messages.length > 0) await sendExpoPushes(messages);

  // Stamp every event in the batch as processed (idempotent: re-runs skip them).
  const ids = (events as ActivityEventRow[]).map((e) => e.id);
  const { error: stampErr } = await admin
    .from("activity_events")
    .update({ processed_at: new Date().toISOString() })
    .in("id", ids);
  if (stampErr) {
    console.warn("[activity-push] failed to stamp processed_at", stampErr.message);
  }

  return new Response(
    JSON.stringify({ ok: true, processed: ids.length, pushed: messages.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
