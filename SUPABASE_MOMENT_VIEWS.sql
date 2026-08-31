-- Additive: unique moment views from source. Safe to run on an existing database.
-- Resets inflated local counts. Owner views are not counted.

alter table public.moments
  add column if not exists views integer not null default 0;

create table if not exists public.moment_views (
  moment_id uuid not null references public.moments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (moment_id, user_id)
);

create index if not exists moment_views_user_id_idx
  on public.moment_views (user_id);

alter table public.moment_views enable row level security;

drop policy if exists "moment_views_select_authenticated" on public.moment_views;
create policy "moment_views_select_authenticated"
on public.moment_views
for select
to authenticated
using (true);

drop function if exists public.increment_moment_views(uuid);

create or replace function public.record_moment_view(moment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer uuid;
  owner uuid;
  total integer;
begin
  viewer := auth.uid();
  if viewer is null or moment_id is null then
    select coalesce(views, 0) into total from public.moments where id = moment_id;
    return coalesce(total, 0);
  end if;

  select user_id into owner from public.moments where id = moment_id;
  if owner is null then
    return 0;
  end if;

  if owner <> viewer then
    insert into public.moment_views (moment_id, user_id)
    values (moment_id, viewer)
    on conflict do nothing;
  end if;

  update public.moments m
  set views = (
    select count(*) from public.moment_views v
    where v.moment_id = m.id
  )
  where m.id = moment_id;

  select coalesce(views, 0) into total from public.moments where id = moment_id;
  return coalesce(total, 0);
end;
$$;

revoke all on function public.record_moment_view(uuid) from public;
grant execute on function public.record_moment_view(uuid) to authenticated;

update public.moments m
set views = (
  select count(*) from public.moment_views v
  where v.moment_id = m.id
);
