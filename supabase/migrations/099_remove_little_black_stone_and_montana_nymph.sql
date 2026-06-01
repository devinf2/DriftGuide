-- Remove Little Black Stone and Montana Nymph from the global fly catalog.
delete from fly_catalog
where name in ('Little Black Stone', 'Montana Nymph') and type = 'fly';
