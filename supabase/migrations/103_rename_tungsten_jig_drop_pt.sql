-- Rename Tungsten Jig PT to Tungsten Jig (drop PT).
update fly_catalog
set name = 'Tungsten Jig (drop PT)'
where name = 'Tungsten Jig PT' and type = 'fly';
