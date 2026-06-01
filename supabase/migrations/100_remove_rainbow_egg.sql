-- Remove Rainbow Egg from the global fly catalog.
delete from fly_catalog
where name = 'Rainbow Egg' and type = 'fly';
