# Analytics (WS-I)

First-party, Supabase-only product analytics. No third-party SDK. The goal is to measure the
install → activation → retention funnel and answer **"which first action predicts return?"**

## How it works

- **Client:** `src/services/analytics.ts` exports `track(event, props?)` and the `AnalyticsEvents`
  name constants. `track` is fire-and-forget, never throws, and is safe to call from anywhere.
- **Transport:** events POST to the Supabase edge function `analytics-ingest`
  (`supabase/functions/analytics-ingest/index.ts`, `verify_jwt = false`). The function does a
  **service-role insert** into `public.analytics_events`, so the table stays fully RLS-locked — no
  client (anon or authed) can read or write it directly.
- **Storage:** migration `supabase/migrations/116_analytics_events.sql`.

### Context attached to every event

| field | source |
|-------|--------|
| `device_id` | stable anonymous UUID, persisted in AsyncStorage (`analytics-device-id`) |
| `user_id` | current signed-in user id, or `null` (read lazily from `useAuthStore` to avoid import cycles) |
| `session_id` | UUID generated once per app launch |
| `platform` | `Platform.OS` |
| `app_version` | `Constants.expoConfig.version` |
| `event`, `props` | the call arguments |
| `ts` / `created_at` | client timestamp (stored in `props.client_ts`) + server-stamped `created_at` |

### Offline handling — **buffer + flush**

When `track` runs while offline (or a send fails), the event is appended to a bounded ring buffer
in AsyncStorage (`analytics-buffer-v1`, capped at 200 events, oldest dropped on overflow). The
buffer is drained:

1. opportunistically the next time `track` runs while online, and
2. via a `NetInfo` connectivity listener that flushes when the device regains internet.

This is the simpler-robust option: the UI is never blocked, there is no tight retry loop, and
storage is bounded. Events can be lost only if the buffer overflows or the app is uninstalled
before a flush — acceptable for product analytics.

## Events (the funnel)

| event | when it fires | wired? |
|-------|---------------|--------|
| `app_open` | root layout mounts (splash hides) | ✅ `app/_layout.tsx` |
| `guest_browse` | unauthenticated user browses content | name only |
| `spot_view` | spot detail screen opens | ✅ `app/spot/[id].tsx` |
| `guide_question` | user asks the AI guide a question | name only |
| `hatch_view` | hatch chart / hatch detail opened | name only |
| `bug_match` | bug/fly match run | name only |
| `start_trip` | a trip is started | name only |
| `first_catch` | first catch logged on a trip | name only |
| `trip_complete` | owner views a completed trip | ✅ `app/trip/[id]/summary.tsx` |
| `signup` | account created | name only |
| `share_sent` | trip share sheet opened | ✅ `app/trip/[id]/summary.tsx` |
| `push_opt_in` | user grants push permission | name only |
| `feed_post` | user posts to the feed | name only |
| `feed_view` | feed surface viewed | name only |

Constants live in `AnalyticsEvents`. Wire additional call sites as `track(AnalyticsEvents.X, {...})`.

## Querying retention & the funnel

`analytics_events` is append-only. Use `device_id` for pre-signup identity and `user_id` once known.
Retention "by first action" keys off the first event a device fired (excluding `app_open`).

### Funnel (counts of distinct devices reaching each step)

```sql
select event, count(distinct device_id) as devices
from public.analytics_events
where created_at >= now() - interval '30 days'
  and event in (
    'app_open','guest_browse','spot_view','guide_question','hatch_view','bug_match',
    'start_trip','first_catch','trip_complete','signup','share_sent','feed_view'
  )
group by event
order by devices desc;
```

### First action per device

```sql
-- The earliest non-app_open event for each device.
create or replace view public.v_device_first_action as
select distinct on (device_id)
  device_id,
  event       as first_action,
  created_at  as first_action_at
from public.analytics_events
where event <> 'app_open'
order by device_id, created_at asc;
```

### D1 / D7 / D30 retention by first action

"Returned on day N" = the device fired any event in the [N, N+1) day window after its first action.

```sql
with first_action as (
  select device_id, first_action, first_action_at
  from public.v_device_first_action
),
returns as (
  select
    fa.first_action,
    fa.device_id,
    bool_or(e.created_at >= fa.first_action_at + interval '1 day'
            and e.created_at <  fa.first_action_at + interval '2 day')  as d1,
    bool_or(e.created_at >= fa.first_action_at + interval '7 day'
            and e.created_at <  fa.first_action_at + interval '8 day')  as d7,
    bool_or(e.created_at >= fa.first_action_at + interval '30 day'
            and e.created_at <  fa.first_action_at + interval '31 day') as d30
  from first_action fa
  join public.analytics_events e on e.device_id = fa.device_id
  group by fa.first_action, fa.device_id
)
select
  first_action,
  count(*)                                              as cohort_devices,
  round(100.0 * avg(d1::int), 1)                        as d1_pct,
  round(100.0 * avg(d7::int), 1)                        as d7_pct,
  round(100.0 * avg(d30::int), 1)                       as d30_pct
from returns
group by first_action
order by cohort_devices desc;
```

The `first_action` rows with the highest `d7_pct` / `d30_pct` are the activation moments to
optimize the onboarding toward.

## Deployment (required before any data flows)

1. Apply the migration: `116_analytics_events.sql` (via `supabase db` / migration push).
2. Deploy the edge function: `supabase functions deploy analytics-ingest`. It is already registered
   with `verify_jwt = false` in `supabase/config.toml`.
3. The function relies on the platform-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
   (or `SERVICE_ROLE_KEY`) secrets — present by default for Supabase edge functions.

Until the migration and function are deployed, `track` is a safe no-op (sends fail, events buffer,
nothing throws).
