-- Remove Midges (generic) from the global fly catalog.
delete from fly_catalog
where name = 'Midges (generic)' and type = 'fly';
