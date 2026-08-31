-- Restore Abu Haitham on assan556 without mixing Fares (assan666).
-- Additive. Does not drop tables. Safe to re-run.

do $$
declare
  abu uuid;
  fares uuid;
begin
  select id into abu
  from auth.users
  where lower(email) = 'assan556@hotmail.com'
  limit 1;

  select id into fares
  from auth.users
  where lower(email) = 'assan666@hotmail.com'
  limit 1;

  if abu is not null then
    insert into public.profiles (id, username, display_name)
    values (abu, 'alshryhy', 'أبو هيثم')
    on conflict (id) do update
      set username = 'alshryhy',
          display_name = 'أبو هيثم';

    update auth.users
    set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('name', 'أبو هيثم', 'full_name', 'أبو هيثم', 'username', 'alshryhy')
    where id = abu;
  end if;

  if fares is not null and fares is distinct from abu then
    insert into public.profiles (id, username, display_name)
    values (fares, 'assan6665', 'فارس')
    on conflict (id) do update
      set username = 'assan6665',
          display_name = 'فارس';

    update auth.users
    set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('name', 'فارس', 'full_name', 'فارس', 'username', 'assan6665')
    where id = fares;
  end if;
end $$;
