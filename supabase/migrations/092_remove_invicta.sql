-- Remove Invicta from the global fly catalog.
delete from fly_catalog
where name = 'Invicta' and type = 'fly';
