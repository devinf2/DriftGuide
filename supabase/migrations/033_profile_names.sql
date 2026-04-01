alter table profiles add column if not exists first_name text;
alter table profiles add column if not exists last_name text;

comment on column profiles.first_name is 'User given name (optional)';
comment on column profiles.last_name is 'User family name (optional)';
