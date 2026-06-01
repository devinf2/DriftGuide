-- Rename Sexy Walt's to Sexy Walt's Hare's Ear.
update fly_catalog
set name = 'Sexy Walt''s Hare''s Ear'
where name = 'Sexy Walt''s' and type = 'fly';
