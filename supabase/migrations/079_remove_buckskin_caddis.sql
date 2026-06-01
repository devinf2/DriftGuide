-- Remove Buckskin Caddis from the global fly catalog.
delete from fly_catalog
where name = 'Buckskin Caddis' and type = 'fly';
