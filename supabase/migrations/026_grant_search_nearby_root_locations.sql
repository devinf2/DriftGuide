-- Allow logged-in clients to call the parent-candidate search (some projects omit default EXECUTE).

grant execute on function public.search_nearby_root_locations(
  double precision,
  double precision,
  uuid,
  double precision
) to authenticated;
