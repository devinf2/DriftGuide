-- Remove CDC Caddis from the global fly catalog.
delete from fly_catalog
where name = 'CDC Caddis' and type = 'fly';
