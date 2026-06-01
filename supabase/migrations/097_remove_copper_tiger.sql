-- Remove Copper Tiger from the global fly catalog.
delete from fly_catalog
where name = 'Copper Tiger' and type = 'fly';
