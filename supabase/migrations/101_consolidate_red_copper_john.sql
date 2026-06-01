-- Consolidate Red Copper John into Copper John.
do $$
declare
  copper_john_id uuid;
  red_copper_john_id uuid;
begin
  select id into copper_john_id from fly_catalog where name = 'Copper John' and type = 'fly';
  if copper_john_id is null then
    raise exception 'Copper John catalog row missing';
  end if;

  select id into red_copper_john_id from fly_catalog where name = 'Red Copper John' and type = 'fly';
  if red_copper_john_id is null then
    return;
  end if;

  update user_fly_box target
  set quantity = target.quantity + src.quantity
  from user_fly_box src
  where src.fly_id = red_copper_john_id
    and target.fly_id = copper_john_id
    and target.user_id = src.user_id
    and target.fly_color_id is not distinct from src.fly_color_id
    and target.fly_size_id is not distinct from src.fly_size_id;

  delete from user_fly_box src
  using user_fly_box target
  where src.fly_id = red_copper_john_id
    and target.fly_id = copper_john_id
    and target.user_id = src.user_id
    and target.fly_color_id is not distinct from src.fly_color_id
    and target.fly_size_id is not distinct from src.fly_size_id
    and src.id <> target.id;

  update user_fly_box
  set fly_id = copper_john_id
  where fly_id = red_copper_john_id;

  update photos
  set fly_id = copper_john_id
  where fly_id = red_copper_john_id;
end $$;

delete from fly_catalog
where name = 'Red Copper John' and type = 'fly';
