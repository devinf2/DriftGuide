-- Consolidate Partridge and Green/Orange/Yellow into a single Partridge pattern.
insert into fly_catalog (name, type, presentation)
values ('Partridge', 'fly', 'wet')
on conflict (name, type) do update set presentation = excluded.presentation;

do $$
declare
  partridge_id uuid;
  old_id uuid;
begin
  select id into partridge_id from fly_catalog where name = 'Partridge' and type = 'fly';
  if partridge_id is null then
    raise exception 'Partridge catalog row missing after insert';
  end if;

  for old_id in
    select id from fly_catalog
    where name in ('Partridge and Green', 'Partridge and Orange', 'Partridge and Yellow')
      and type = 'fly'
  loop
    update user_fly_box target
    set quantity = target.quantity + src.quantity
    from user_fly_box src
    where src.fly_id = old_id
      and target.fly_id = partridge_id
      and target.user_id = src.user_id
      and target.fly_color_id is not distinct from src.fly_color_id
      and target.fly_size_id is not distinct from src.fly_size_id;

    delete from user_fly_box src
    using user_fly_box target
    where src.fly_id = old_id
      and target.fly_id = partridge_id
      and target.user_id = src.user_id
      and target.fly_color_id is not distinct from src.fly_color_id
      and target.fly_size_id is not distinct from src.fly_size_id
      and src.id <> target.id;

    update user_fly_box
    set fly_id = partridge_id
    where fly_id = old_id;

    update photos
    set fly_id = partridge_id
    where fly_id = old_id;
  end loop;
end $$;

delete from fly_catalog
where name in ('Partridge and Green', 'Partridge and Orange', 'Partridge and Yellow')
  and type = 'fly';
