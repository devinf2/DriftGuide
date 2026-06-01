-- Remove CDC Midge from the global fly catalog.
delete from fly_catalog
where name = 'CDC Midge' and type = 'fly';
