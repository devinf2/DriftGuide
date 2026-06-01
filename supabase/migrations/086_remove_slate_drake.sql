-- Remove Slate Drake from the global fly catalog.
delete from fly_catalog
where name = 'Slate Drake' and type = 'fly';
