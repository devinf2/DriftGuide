-- Remove Batwing Emerger from the global fly catalog.
delete from fly_catalog
where name = 'Batwing Emerger' and type = 'fly';
