-- Rename Salmonfly to Kamikaze Salmonfly in the global fly catalog.
update fly_catalog
set name = 'Kamikaze Salmonfly'
where name = 'Salmonfly' and type = 'fly';
