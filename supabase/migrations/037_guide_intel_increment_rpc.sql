-- Atomic increment for Edge rate limiting (service_role only).
create or replace function public.guide_intel_increment_usage(p_user uuid, p_day date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer;
begin
  insert into public.guide_intel_usage (user_id, day, request_count)
  values (p_user, p_day, 1)
  on conflict (user_id, day) do update
  set request_count = public.guide_intel_usage.request_count + 1
  returning request_count into v;
  return v;
end;
$$;

revoke all on function public.guide_intel_increment_usage(uuid, date) from public;
grant execute on function public.guide_intel_increment_usage(uuid, date) to service_role;
