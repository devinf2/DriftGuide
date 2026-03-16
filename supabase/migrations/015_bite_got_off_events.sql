-- Add bite and got_off to event_type for trip log data capture
alter type event_type add value if not exists 'bite';
alter type event_type add value if not exists 'got_off';
