-- Rename No Hackle BWO to No Hackle Dry in the global fly catalog.
update fly_catalog
set name = 'No Hackle Dry'
where name = 'No Hackle BWO' and type = 'fly';
