-- Add Shimmer Bugger to the global fly catalog.
insert into fly_catalog (name, type, presentation)
values ('Shimmer Bugger', 'fly', 'streamer')
on conflict (name, type) do update set presentation = excluded.presentation;
