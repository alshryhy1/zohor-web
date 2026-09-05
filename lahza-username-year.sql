-- Display name (Arabic) is free. Handle (@id) may change at most once per 365 days.
-- Replaces profiles_guard_identity_swap which blocked name+handle in the same save.
-- Additive. Safe to re-run.

alter table public.profiles
  add column if not exists username_changed_at timestamptz;

drop trigger if exists profiles_guard_identity_swap on public.profiles;
drop function if exists public.profiles_guard_identity_swap();

create or replace function public.profiles_guard_username_year()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.username is distinct from old.username
     and old.username_changed_at is not null
     and old.username_changed_at > now() - interval '365 days'
  then
    raise exception 'username_year_locked'
      using errcode = 'restrict_violation';
  end if;
  if tg_op = 'UPDATE' and new.username is distinct from old.username then
    new.username_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_username_year on public.profiles;
create trigger profiles_guard_username_year
before update on public.profiles
for each row
execute function public.profiles_guard_username_year();
