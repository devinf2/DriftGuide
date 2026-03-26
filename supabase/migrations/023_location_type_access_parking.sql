-- Broaden location_type beyond water bodies (trailheads, parking, etc.).

alter type location_type add value if not exists 'access_point';
alter type location_type add value if not exists 'parking';
