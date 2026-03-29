-- Creators may edit pin / visibility / soft-delete while only their own trips use the location.
-- Guard + RPC treat "blocking" usage as trips owned by someone other than locations.created_by.

create or replace function public.location_has_active_trip_usage_by_other_users(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trips t
    inner join public.locations l on l.id = p_location_id
    where t.location_id = p_location_id
      and t.deleted_at is null
      and (
        l.created_by is null
        or t.user_id is distinct from l.created_by
      )
  );
$$;

revoke all on function public.location_has_active_trip_usage_by_other_users(uuid) from public;

create or replace function public.location_creator_manage_state(p_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  loc record;
  usage boolean;
  blocking boolean;
begin
  select id, created_by, deleted_at
  into loc
  from public.locations
  where id = p_location_id;

  if loc.id is null then
    return jsonb_build_object('error', 'not_found');
  end if;

  if loc.deleted_at is not null then
    return jsonb_build_object('isCreator', false);
  end if;

  if auth.uid() is null or loc.created_by is distinct from auth.uid() then
    return jsonb_build_object('isCreator', false);
  end if;

  usage := public.location_has_active_trip_usage(p_location_id);
  blocking := public.location_has_active_trip_usage_by_other_users(p_location_id);

  return jsonb_build_object(
    'isCreator', true,
    'hasActiveTripUsage', usage,
    'canManageUnusedOnly', not blocking
  );
end;
$$;

revoke all on function public.location_creator_manage_state(uuid) from public;
grant execute on function public.location_creator_manage_state(uuid) to authenticated;

create or replace function public.enforce_location_usage_updates()
returns trigger
language plpgsql
as $$
begin
  if public.location_has_active_trip_usage_by_other_users(new.id) then
    if old.deleted_at is null and new.deleted_at is not null then
      raise exception 'This spot is on one or more trips and cannot be removed.'
        using errcode = 'P0001';
    end if;
    if new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude then
      raise exception 'Pin cannot be moved while this spot is used on a trip.'
        using errcode = 'P0001';
    end if;
    if new.is_public is distinct from old.is_public then
      raise exception 'Visibility cannot change while this spot is used on a trip.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
