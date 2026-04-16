-- Public RPC for Edge Function: safe Open Graph fields for trip share links.
-- Rich preview only when effective_trip_photo_visibility is public; otherwise generic (anti-enumeration).

create or replace function public.trip_link_preview(p_trip_id uuid)
returns table (
  rich_preview boolean,
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
    select
      false,
      'DriftGuide'::text,
      'Open in the app to see this trip.'::text,
      null::text;
    return;
  end if;

  v_vis := public.effective_trip_photo_visibility(p_trip_id);

  if v_vis is distinct from 'public'::public.trip_photo_visibility then
    return query
    select
      false,
      'DriftGuide'::text,
      'Open in the app to see this trip.'::text,
      null::text;
    return;
  end if;

  select t.start_time, t.total_fish, nullif(trim(l.name), '')
  into v_start, v_fish, v_loc_name
  from public.trips t
  left join public.locations l on l.id = t.location_id
  where t.id = p_trip_id
  limit 1;

  select p.url into v_img
  from public.photos p
  where p.trip_id = p_trip_id
    and p.deleted_at is null
  order by p.created_at asc nulls last, p.id asc
  limit 1;

  return query
  select
    true,
    case
      when v_loc_name is not null then v_loc_name || ' · DriftGuide'
      else 'Fishing trip · DriftGuide'
    end,
    to_char(v_start at time zone 'UTC', 'Mon DD, YYYY')
      || ' · '
      || coalesce(v_fish::text, '0')
      || ' fish',
    v_img;
end;
$$;

comment on function public.trip_link_preview(uuid) is
  'Share-link metadata: rich OG only for public trip_photo_visibility; generic otherwise.';

revoke all on function public.trip_link_preview(uuid) from public;
grant execute on function public.trip_link_preview(uuid) to service_role;
