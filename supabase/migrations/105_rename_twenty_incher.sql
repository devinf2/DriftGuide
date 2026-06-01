-- Rename Twenty Incher to 20 Incher.
update fly_catalog
set name = '20 Incher'
where name = 'Twenty Incher' and type = 'fly';
