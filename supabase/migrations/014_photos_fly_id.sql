-- Optional link from photo to catalog fly (when captured with a fly on the line).
alter table photos add column if not exists fly_id uuid references fly_catalog(id) on delete set null;
comment on column photos.fly_id is 'Catalog fly when photo was taken with this fly (optional).';
