-- Add presentation (how the fly fishes: dry, emerger, wet, nymph, streamer) to flies.
-- photo_url already exists on flies for user-uploaded images.

alter table flies add column if not exists presentation text;

comment on column flies.presentation is 'Fly fishing presentation: dry (floats) | emerger (surface film) | wet (just below surface) | nymph (subsurface) | streamer (subsurface, stripped)';
