-- Add fish_on to event_type (replaces Got Off in UI)
alter type event_type add value if not exists 'fish_on';
