-- Add planned_date column to trips table
alter table trips add column if not exists planned_date timestamptz;
