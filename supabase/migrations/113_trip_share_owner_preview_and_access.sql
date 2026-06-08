-- Trip share links: owner-named Open Graph preview + authoritative in-app access check.
--
-- 1) trip_link_preview: title is now the trip OWNER's name (was "<location> · DriftGuide").
--    Adds a `visibility` column so the edge landing page can branch its message.
--    Rich preview (first photo) only for public trips; private/friends_only return the
--    brand logo + a per-visibility message. Owner name is intentionally surfaced even for
--    non-public trips so the share page can say "add <name> on DriftGuide to view".
--
-- 2) trip_share_access: viewer-aware gate the app calls when opening a shared link.
--    Returns whether the current auth.uid() may view the trip, plus owner identity for the
--    "Add <name> to see this trip" / "This trip is private" screens.

-- ---------------------------------------------------------------------------
-- 1) Owner-named OG preview
-- ---------------------------------------------------------------------------
drop function if exists public.trip_link_preview(uuid);

create or replace function public.trip_link_preview(p_trip_id uuid)
returns table (
  rich_preview boolean,
  visibility text,
  title text,
  description text,
  image_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vis public.trip_photo_visibility;
  v_owner uuid;
  v_owner_name text;
  v_loc_name text;
  v_img text;
  v_start timestamptz;
  v_fish integer;
begin
  if not exists (
    select 1 from public.trips t
    where t.id = p_trip_id and t.deleted_at is null
  ) then
    return query
    select false, 'unknown'::text, 'DriftGuide'::text,
      'Open in the app to see this trip.'::text, null::text;
    return;
  end if;

  select t.user_id, t.start_time, t.total_fish, nullif(trim(l.name), ''),
         coalesce(nullif(trim(pr.display_name), ''), nullif(trim(pr.first_name), ''),
                  nullif(trim(pr.username), ''), 'A DriftGuide angler')
  into v_owner, v_start, v_fish, v_loc_name, v_owner_name
  from public.trips t
  inner join public.profiles pr on pr.id = t.user_id
  left join public.locations l on l.id = t.location_id
  where t.id = p_trip_id
  limit 1;

  v_vis := public.effective_trip_photo_visibility(p_trip_id);

  if v_vis is distinct from 'public'::public.trip_photo_visibility then
    return query
    select
      false,
      v_vis::text,
      v_owner_name,
      case
        when v_vis = 'friends_only'::public.trip_photo_visibility
          then 'Friends-only trip — add ' || v_owner_name || ' on DriftGuide to view.'
        else 'This trip is private.'
      end,
      null::text;
    return;
  end if;

  select p.url into v_img
  from public.photos p
  where p.trip_id = p_trip_id
    and p.deleted_at is null
  order by p.created_at asc nulls last, p.id asc
  limit 1;

  return query
  select
    true,
    'public'::text,
    v_owner_name,
    to_char(v_start at time zone 'UTC', 'Mon DD, YYYY')
      || ' · ' || coalesce(v_fish::text, '0') || ' fish'
      || case when v_loc_name is not null then ' · ' || v_loc_name else '' end,
    v_img;
end;
$$;

comment on function public.trip_link_preview(uuid) is
  'Share-link OG metadata: title = trip owner name; rich (first photo) only for public visibility.';

revoke all on function public.trip_link_preview(uuid) from public;
grant execute on function public.trip_link_preview(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2) Viewer-aware access gate (called by the app when opening a shared link)
-- ---------------------------------------------------------------------------
create or replace function public.trip_share_access(p_trip_id uuid)
returns table (
  trip_exists boolean,
  visibility text,
  owner_id uuid,
  owner_name text,
  owner_username text,
  owner_avatar_url text,
  can_view boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_owner uuid;
  v_vis public.trip_photo_visibility;
  v_name text;
  v_username text;
  v_avatar text;
begin
  select t.user_id into v_owner
  from public.trips t
  where t.id = p_trip_id and t.deleted_at is null
  limit 1;

  if v_owner is null then
    return query select false, null::text, null::uuid, null::text, null::text, null::text, false;
    return;
  end if;

  select coalesce(nullif(trim(pr.display_name), ''), nullif(trim(pr.first_name), ''),
                  nullif(trim(pr.username), ''), 'A DriftGuide angler'),
         pr.username, pr.avatar_url
  into v_name, v_username, v_avatar
  from public.profiles pr
  where pr.id = v_owner
  limit 1;

  v_vis := public.effective_trip_photo_visibility(p_trip_id);

  return query
  select
    true,
    v_vis::text,
    v_owner,
    v_name,
    v_username,
    v_avatar,
    (
      v_viewer = v_owner
      or v_vis = 'public'::public.trip_photo_visibility
      or (
        v_vis = 'friends_only'::public.trip_photo_visibility
        and v_viewer is not null
        and public.accepted_friends(v_owner, v_viewer)
      )
    );
end;
$$;

comment on function public.trip_share_access(uuid) is
  'Viewer-aware trip access for shared links: can_view + owner identity for gating screens.';

revoke all on function public.trip_share_access(uuid) from public;
grant execute on function public.trip_share_access(uuid) to authenticated;
