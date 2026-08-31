-- Block swapping both username and display_name on an established profile.
-- Signup must insert a new row by user id, never overwrite another account.
-- Additive. Safe to re-run.

create or replace function public.profiles_guard_identity_swap()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.username is not null
     and btrim(old.username) <> ''
     and new.username is distinct from old.username
     and new.display_name is distinct from old.display_name
     and coalesce(old.created_at, now()) < now() - interval '15 minutes'
  then
    raise exception 'identity_swap_blocked'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_identity_swap on public.profiles;
create trigger profiles_guard_identity_swap
before update on public.profiles
for each row
execute function public.profiles_guard_identity_swap();
