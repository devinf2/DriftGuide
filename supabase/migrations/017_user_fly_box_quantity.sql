-- Quantity per fly box entry (how many of this fly/size/color the user has).
alter table user_fly_box add column if not exists quantity integer not null default 1;
comment on column user_fly_box.quantity is 'Number of this fly (same pattern, size, color) the user has; can go up/down over time.';
