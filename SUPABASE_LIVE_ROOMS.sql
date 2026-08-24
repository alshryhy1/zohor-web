-- Additive: live rooms from source. Safe to run on an existing database.

create table if not exists public.live_rooms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  username text,
  channel text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists live_rooms_created_at_idx
  on public.live_rooms (created_at desc);

alter table public.live_rooms enable row level security;

drop policy if exists "live_rooms_select_authenticated" on public.live_rooms;
create policy "live_rooms_select_authenticated"
on public.live_rooms
for select
to authenticated
using (true);

drop policy if exists "live_rooms_insert_own" on public.live_rooms;
create policy "live_rooms_insert_own"
on public.live_rooms
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "live_rooms_delete_own" on public.live_rooms;
create policy "live_rooms_delete_own"
on public.live_rooms
for delete
to authenticated
using (user_id = auth.uid());
