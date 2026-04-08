-- OAuth providers (e.g. Google) often set full_name / name in raw_user_meta_data, not display_name.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1),
      'Angler'
    )
  );
  return new;
end;
$$ language plpgsql security definer;
