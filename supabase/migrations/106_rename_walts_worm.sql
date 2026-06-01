-- Rename Walt's Worm to Sexy Walt's Worm.
update fly_catalog
set name = 'Sexy Walt''s Worm'
where name = 'Walt''s Worm' and type = 'fly';
