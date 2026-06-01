-- Remove Cluster Midge from the global fly catalog.
delete from fly_catalog
where name = 'Cluster Midge' and type = 'fly';
